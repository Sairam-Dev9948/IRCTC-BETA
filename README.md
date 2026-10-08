# IRCTC Beta Passenger Autofill v2.1.0

Chrome Manifest V3 extension for saving passenger profiles and filling them on IRCTC booking pages.

## Use

1. Reload the unpacked extension in `chrome://extensions/`.
2. Open an IRCTC booking page.
3. Enter each passenger's name, age, gender, berth preference, and nationality in the extension popup, then click **Add passenger to saved list**.
4. Repeat for each passenger. Saved passengers appear in order and can be removed individually.
5. Click **Auto Fill All Passengers**. For each saved passenger, the extension clicks **New Passenger**, fills the profile, and clicks **Add**. It verifies each passenger appears in the booking passenger list and stops without calculating fare if any passenger is unconfirmed. After all passengers are confirmed, it selects **Pay through BHIM/UPI**, clicks **Calculate Fare**, waits for fare calculation and page updates to finish, waits one additional second, then clicks **Continue to Payment** (or **Continue**) when ready. If fare calculation does not finish or the continue button does not become ready, the popup reports an error.
6. Verify the passenger details and fare manually before proceeding.

Existing single-passenger profiles are migrated to the saved passenger list the first time the updated extension is opened.

## Limitations

- IRCTC may change its page controls; verify all passenger details and fare.
- The extension does not store IRCTC login credentials, bypass CAPTCHA, solve OTP, or enter payment credentials.
- Continue to Payment only advances to the payment step; the extension does not complete payment.
