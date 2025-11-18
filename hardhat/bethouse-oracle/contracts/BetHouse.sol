// File: /hardhat/contracts/BetHouse.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";


contract BetHouse is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20  public immutable collateral;
    uint16  public constant FEE_BET_BPS        = 200; // 2.00% de comision
    uint64  public constant ROUND_SECONDS      = 100; // duracion total ronda
    uint64  public constant BET_WINDOW_SECONDS = 60;  // ventana de apuesta (1 minuto)

    struct Round {
        uint64  startTime;
        uint64  endTime;
        bool    active;
        bool    resolved;
        bool    outcomeYes;   // solo si resolved && !refundMode
        bool    refundMode;   // true si solo un lado tiene apuesta
        uint256 totalYesNet;  // suma neta post fee yes
        uint256 totalNoNet;   // mismo para no
        uint256 feeAccrued;   // fees de la ronda en contrato hasta resolverse
    }

    uint256 public currentRoundId;
    mapping(uint256 => Round) public rounds;

    // apuestas por user con neto y bruto (cobro y devolucion)
    mapping(uint256 => mapping(address => uint256)) public stakeYesNet;
    mapping(uint256 => mapping(address => uint256)) public stakeNoNet;
    mapping(uint256 => mapping(address => uint256)) public stakeYesGross;
    mapping(uint256 => mapping(address => uint256)) public stakeNoGross;

    // control de cobro y reembolso
    mapping(uint256 => mapping(address => bool)) public claimed;

    // fees disponibles para retirar por owner
    uint256 public feeVault;

    // eventos
    event RoundStarted(uint256 indexed id, uint64 startTime, uint64 endTime);
    event BetPlaced(
        address indexed user,
        uint256 indexed id,
        bool isYes,
        uint256 gross,
        uint256 net,
        uint256 fee
    );
    event RoundResolved(uint256 indexed id, bool refundMode, bool outcomeYes);
    event Claimed(address indexed user, uint256 indexed id, uint256 payout);
    event Refunded(address indexed user, uint256 indexed id, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount);

    // errores
    error ErrActiveRound();
    error ErrNoActive();
    error ErrTooEarly();
    error ErrTooLate();
    error ErrZero();
    error ErrBadRound();
    error ErrNotResolved();
    error ErrAlreadyClaimed();
    error ErrNoWin();

 //   constructor(address _collateral, address _owner) {
   //     require(_collateral != address(0), "bad collateral");
     //   collateral = IERC20(_collateral);
       // _transferOwnership(_owner);
   // }
    
    constructor(address _collateral, address _owner) Ownable(_owner) {
        require(_collateral != address(0), "bad collateral");
        collateral = IERC20(_collateral);
    }

    // gestion de rondas

    function startRound() external onlyOwner {
        if (currentRoundId != 0) {
            Round storage prev = rounds[currentRoundId];
            if (prev.active && block.timestamp < prev.endTime) revert ErrActiveRound();
        }
        uint256 id = currentRoundId + 1;
        currentRoundId = id;

        rounds[id] = Round({
            startTime:  uint64(block.timestamp),
            endTime:    uint64(block.timestamp + ROUND_SECONDS),
            active:     true,
            resolved:   false,
            outcomeYes: false,
            refundMode: false,
            totalYesNet:0,
            totalNoNet: 0,
            feeAccrued: 0
        });

        emit RoundStarted(id, rounds[id].startTime, rounds[id].endTime);
    }

    // endRound con cierre temprano en modo refund
    function endRound(uint256 id, bool outcomeYes_) external onlyOwner {
        if (id == 0 || id > currentRoundId) revert ErrBadRound();
        Round storage r = rounds[id];
        if (!r.active) revert ErrNoActive();
        if (r.resolved) revert ErrBadRound();

        bool yesHas = r.totalYesNet > 0;
        bool noHas  = r.totalNoNet  > 0;

        uint64 betWindowClose = r.startTime + BET_WINDOW_SECONDS;

        if (yesHas && noHas) {
            // modo normal: hay apuestas en ambos lados -> esperar fin de ronda completo
            if (block.timestamp < r.endTime) revert ErrTooEarly();
        } else {
            // modo refund: solo un lado (o ninguno) -> se puede cerrar al acabar ventana de apuestas
            if (block.timestamp < betWindowClose) revert ErrTooEarly();
        }

        r.active = false;
        r.resolved = true;

        if (yesHas && noHas) {
            r.refundMode = false;
            r.outcomeYes = outcomeYes_;
            // fees de ronda pasan a vault
            feeVault += r.feeAccrued;
        } else {
            // devolucion bruta si solo hubo un lado con bet (o ninguna apuesta)
            r.refundMode = true;
            r.outcomeYes = false;
        }

        emit RoundResolved(id, r.refundMode, r.outcomeYes);
    }

    // apuestas

    function betYes(uint256 id, uint256 amount) external nonReentrant {
        _bet(id, amount, true);
    }

    function betNo(uint256 id, uint256 amount) external nonReentrant {
        _bet(id, amount, false);
    }

    function _bet(uint256 id, uint256 amount, bool isYes) internal {
        if (amount == 0) revert ErrZero();
        Round storage r = rounds[id];
        if (!r.active) revert ErrNoActive();
        if (block.timestamp >= r.endTime) revert ErrTooLate();
        if (block.timestamp > r.startTime + BET_WINDOW_SECONDS) revert ErrTooLate(); // fuera de ventana 1m

        collateral.safeTransferFrom(msg.sender, address(this), amount);

        uint256 fee = (amount * FEE_BET_BPS) / 10_000;
        uint256 net = amount - fee;

        r.feeAccrued += fee;

        if (isYes) {
            stakeYesGross[id][msg.sender] += amount;
            stakeYesNet[id][msg.sender]   += net;
            r.totalYesNet                 += net;
        } else {
            stakeNoGross[id][msg.sender]  += amount;
            stakeNoNet[id][msg.sender]    += net;
            r.totalNoNet                  += net;
        }

        emit BetPlaced(msg.sender, id, isYes, amount, net, fee);
    }

    // cobro prorrata ganador
    function claim(uint256 id) external nonReentrant {
        Round storage r = rounds[id];
        if (!r.resolved) revert ErrNotResolved();
        if (r.refundMode) revert ErrBadRound();
        if (claimed[id][msg.sender]) revert ErrAlreadyClaimed();

        uint256 userNet;
        uint256 winnersTotal;
        if (r.outcomeYes) {
            userNet = stakeYesNet[id][msg.sender];
            if (userNet == 0) revert ErrNoWin();
            winnersTotal = r.totalYesNet;
            stakeYesNet[id][msg.sender] = 0; // consume stake
        } else {
            userNet = stakeNoNet[id][msg.sender];
            if (userNet == 0) revert ErrNoWin();
            winnersTotal = r.totalNoNet;
            stakeNoNet[id][msg.sender] = 0; // consume stake
        }

        claimed[id][msg.sender] = true;

        uint256 pool = r.totalYesNet + r.totalNoNet; // solo neto
        uint256 payout = (pool * userNet) / winnersTotal;

        collateral.safeTransfer(msg.sender, payout);
        emit Claimed(msg.sender, id, payout);
    }

    // devolucion integra (modo refund)
    function refund(uint256 id) external nonReentrant {
        Round storage r = rounds[id];
        if (!r.resolved) revert ErrNotResolved();
        if (!r.refundMode) revert ErrBadRound();
        if (claimed[id][msg.sender]) revert ErrAlreadyClaimed();

        uint256 gross = stakeYesGross[id][msg.sender];
        if (gross == 0) {
            gross = stakeNoGross[id][msg.sender];
        }
        if (gross == 0) revert ErrNoWin(); // nada que devolver

        stakeYesGross[id][msg.sender] = 0;
        stakeNoGross[id][msg.sender]  = 0;
        stakeYesNet[id][msg.sender]   = 0;
        stakeNoNet[id][msg.sender]    = 0;
        claimed[id][msg.sender]       = true;

        collateral.safeTransfer(msg.sender, gross);
        emit Refunded(msg.sender, id, gross);
    }

    // retiro de fees por el owner

    function withdrawFees(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "bad to");
        require(amount <= feeVault, "exceeds vault");
        feeVault -= amount;
        collateral.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }
}
