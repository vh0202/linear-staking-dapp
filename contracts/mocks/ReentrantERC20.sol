// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ReentrantERC20
/// @notice Malicious token used ONLY by the reentrancy tests.
/// @dev It plays two roles at once:
///      - attacker: through {execute} the token contract itself can approve, stake, unstake
///        and claim, so it can be a genuine staker with a balance worth stealing twice;
///      - hook: once {arm}ed, the next token movement calls back into a target from inside
///        the transfer, the way an ERC-777 style hook would hand control to a recipient.
contract ReentrantERC20 is ERC20 {
    address private _target;
    bytes private _payload;
    bool private _armed;
    bool private _swallowFailure;

    /// @notice Outcome of the last callback.
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes public reentryReturnData;

    constructor() ERC20("Reentrant Token", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arm one callback: the next token movement calls `target` with `payload`.
    /// @param swallowFailure When true a failed callback is only recorded, so the outer call
    ///        can complete; when false its revert data is bubbled up unchanged.
    function arm(address target, bytes calldata payload, bool swallowFailure) external {
        _target = target;
        _payload = payload;
        _swallowFailure = swallowFailure;
        _armed = true;
        reentryAttempted = false;
        reentrySucceeded = false;
        reentryReturnData = "";
    }

    /// @notice Cancel a pending callback (an armed callback survives a reverted transaction).
    function disarm() external {
        _armed = false;
    }

    /// @notice Make this token contract call `target` with `data`, bubbling up any revert.
    function execute(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) _bubble(ret);
        return ret;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (!_armed) return;

        _armed = false; // single shot
        (bool ok, bytes memory ret) = _target.call(_payload);
        reentryAttempted = true;
        reentrySucceeded = ok;
        reentryReturnData = ret;
        if (!ok && !_swallowFailure) _bubble(ret);
    }

    function _bubble(bytes memory revertData) private pure {
        assembly ("memory-safe") {
            revert(add(revertData, 0x20), mload(revertData))
        }
    }
}
