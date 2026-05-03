/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui

import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.core.net.toUri
import org.junit.Rule
import org.junit.Test
import org.mozilla.fenix.HomeActivity
import org.mozilla.fenix.helpers.FenixTestRule
import org.mozilla.fenix.helpers.HomeActivityIntentTestRule
import org.mozilla.fenix.helpers.RetryTestRule
import org.mozilla.fenix.helpers.RetryableComposeTestRule
import org.mozilla.fenix.ui.robots.navigationToolbar

class AboutURITest {

    @get:Rule(order = 0)
    val retryTestRule = RetryTestRule(3)

    @get:Rule(order = 1)
    val fenixTestRule: FenixTestRule = FenixTestRule()

    @get:Rule(order = 2)
    val retryableComposeTestRule = RetryableComposeTestRule<HomeActivity, HomeActivityIntentTestRule> {
        AndroidComposeTestRule(
            HomeActivityIntentTestRule.withDefaultSettingsOverrides(),
        ) { it.activity }
    }

    private val composeTestRule get() = retryableComposeTestRule.current

    // TestRail link: https://mozilla.testrail.io/index.php?/cases/view/2944327
    @Test
    fun verifyWebCompatPageIsLoadingTest() {
        val webCompatPage = "about:compat"

        navigationToolbar(composeTestRule) {
        }.enterURLAndEnterToBrowser(webCompatPage.toUri()) {
            verifyUrl(webCompatPage)

            // Verify and interact with the items from the "Interventions" section
            verifyWebCompatPageItemExists("Interventions")
            verifyWebCompatPageItemExists("More Information: Bug")
            verifyWebCompatPageItemExists("Disable")
            clickWebCompatPageItem("Disable")
            verifyWebCompatPageItemExists("Enable")
            clickWebCompatPageItem("Enable")
            verifyWebCompatPageItemExists("Disable")

            // Verify and interact with the items from the "SmartBlock Fixes" section
            clickWebCompatPageItem("SmartBlock Fixes")
            verifyWebCompatPageItemExists("SmartBlock Fixes", isSmartBlockFixesItem = true)
            verifyWebCompatPageItemExists("More Information: Bug", isSmartBlockFixesItem = true)
            verifyWebCompatPageItemExists("Disable", isSmartBlockFixesItem = true)
            clickWebCompatPageItem("Disable")
            verifyWebCompatPageItemExists("Enable", isSmartBlockFixesItem = true)
            clickWebCompatPageItem("Enable")
            verifyWebCompatPageItemExists("Disable", isSmartBlockFixesItem = true)
        }
    }
}
