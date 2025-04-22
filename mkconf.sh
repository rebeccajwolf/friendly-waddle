#!/bin/bash

# Makes accounts.json

cat > /usr/src/microsoft-rewards-script/src/accounts.json <<EOF
${ACCOUNTS}
EOF

cat > /usr/src/microsoft-rewards-script/src/config.json <<EOF
{
    "baseURL": "https://rewards.bing.com",
    "sessionPath": "sessions",
    "headless": false,
    "parallel": false,
    "runOnZeroPoints": false,
    "clusters": 2,
    "saveFingerprint": {
        "mobile": false,
        "desktop": false
    },
    "workers": {
        "doDailySet": true,
        "doMorePromotions": true,
        "doPunchCards": true,
        "doDesktopSearch": true,
        "doMobileSearch": true,
        "doDailyCheckIn": true,
        "doReadToEarn": true
    },
    "searchOnBingLocalQueries": false,
    "globalTimeout": "600s",
    "searchSettings": {
        "useGeoLocaleQueries": false,
        "scrollRandomResults": true,
        "clickRandomResults": true,
        "searchDelay": {
            "min": "17min",
            "max": "27min"
        },
        "retryMobileSearchAmount": 2
    },
    "logExcludeFunc": [
        "SEARCH-CLOSE-TABS"
    ],
    "webhookLogExcludeFunc": [
        "SEARCH-CLOSE-TABS"
    ],
    "proxy": {
        "proxyGoogleTrends": false,
        "proxyBingTerms": false
    },
    "webhook": {
        "enabled": true,
        "url": "${TOKEN}"
    },
    "cronStartTime": "0 5,11 * * *"
}
EOF
