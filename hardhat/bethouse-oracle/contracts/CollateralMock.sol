// File: /hardhat/contracts/CollateralMock.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CollateralMock is ERC20, Ownable {
    uint8 private immutable _decimals;

    constructor(string memory n, string memory s, uint8 d, address owner_)
        ERC20(n, s)
        Ownable(owner_)
    {
        _decimals = d;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

