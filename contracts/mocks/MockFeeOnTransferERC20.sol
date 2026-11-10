// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockFeeOnTransferERC20
/// @notice ERC-20 that burns a configurable fee on every transfer, so the recipient receives
///         less than the amount sent. Used to prove that LinearStaking rejects such tokens.
/// @dev TEST ONLY. The fee can be switched on after deployment to model tokens whose fee is
///      disabled at first and enabled later.
contract MockFeeOnTransferERC20 is ERC20 {
    uint256 public constant BPS = 10_000;

    /// @notice Fee in basis points taken from every transfer between two accounts.
    uint256 public feeBps;

    constructor(uint256 feeBps_) ERC20("Fee On Transfer Token", "FEE") {
        feeBps = feeBps_;
    }

    function setFeeBps(uint256 feeBps_) external {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        uint256 fee = (from == address(0) || to == address(0)) ? 0 : (value * feeBps) / BPS;
        super._update(from, to, value - fee);
        if (fee != 0) super._update(from, address(0), fee);
    }
}
