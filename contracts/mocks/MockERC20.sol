// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice Plain ERC-20 with configurable decimals and an unrestricted `mint`.
/// @dev TEST AND LOCAL DEMO ONLY. Anyone can mint any amount: never use it as a real asset.
contract MockERC20 is ERC20 {
    uint8 private immutable _DECIMALS;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _DECIMALS = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Mint `amount` tokens to `to`. Open to everyone on purpose (test faucet).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
