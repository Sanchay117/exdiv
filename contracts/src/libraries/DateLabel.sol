// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Formats a timestamp as a UTC date label like "31DEC2026", for token names and symbols.
library DateLabel {
    function format(uint256 timestamp) internal pure returns (string memory) {
        (uint256 y, uint256 m, uint256 d) = toDate(timestamp);
        string memory day = d < 10 ? string.concat("0", Strings.toString(d)) : Strings.toString(d);
        return string.concat(day, _month(m), Strings.toString(y));
    }

    /// @dev Howard Hinnant's civil_from_days, for days since 1970-01-01 (always non-negative here).
    function toDate(uint256 timestamp) internal pure returns (uint256 year, uint256 month, uint256 day) {
        uint256 z = timestamp / 1 days + 719_468;
        uint256 era = z / 146_097;
        uint256 doe = z - era * 146_097;
        uint256 yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        day = doy - (153 * mp + 2) / 5 + 1;
        month = mp < 10 ? mp + 3 : mp - 9;
        year = yoe + era * 400 + (month <= 2 ? 1 : 0);
    }

    function _month(uint256 m) private pure returns (string memory) {
        return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][m - 1];
    }
}
