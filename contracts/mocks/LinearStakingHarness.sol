// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LinearStaking} from "../LinearStaking.sol";

/// @title LinearStakingHarness
/// @notice LinearStaking plus a back door that corrupts the reward ledger.
/// @dev TEST ONLY. The reserve check in LinearStaking is unreachable through the public API
///      (that is the point of it), so the tests need a way to simulate a bug in the reward
///      maths and show that even then a payout cannot exceed the reward reserve.
contract LinearStakingHarness is LinearStaking {
    constructor(
        IERC20 stakingToken_,
        IERC20 rewardsToken_,
        address initialOwner
    ) LinearStaking(stakingToken_, rewardsToken_, initialOwner) {}

    /// @notice Credit `amount` unearned rewards to `account`, as a faulty accrual would.
    function harnessCreditRewards(address account, uint256 amount) external {
        rewards[account] += amount;
    }
}
