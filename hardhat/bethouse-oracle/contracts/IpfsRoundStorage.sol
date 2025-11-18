// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Almacén de reportes IPFS por ronda de BetHouse
/// @notice Guarda el CID del reporte JSON de cada ronda
contract IpfsRoundStorage is Ownable {
    // roundId => CID (string)
    mapping(uint256 => string) public roundReports;

    event RoundReportSet(uint256 indexed roundId, string cid);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Registra / actualiza el CID de una ronda
    /// @dev En la práctica, lo usará tu bot-oráculo (owner)
    function setRoundReport(uint256 roundId, string calldata cid) external onlyOwner {
        require(bytes(cid).length > 0, "empty cid");
        roundReports[roundId] = cid;
        emit RoundReportSet(roundId, cid);
    }

    /// @notice Devuelve el CID de una ronda (helper explícito)
    function getRoundReport(uint256 roundId) external view returns (string memory) {
        return roundReports[roundId];
    }
}
