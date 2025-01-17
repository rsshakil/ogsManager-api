const defaultErrorMessage = require("./default");

const commonErrorEn = defaultErrorMessage.defaultMessages.en;

const en = {
    320: "The Epsilon system is unable to communicate with the card company.",
    330: "Communication from Epsilon's system to WebMoney's payment server is not possible.",
    331: "Epsilon's system was unable to properly receive the payment result notification sent from WebMoney's payment server.",
    501: "Database update failed.",
    502: commonErrorEn,
    503: commonErrorEn,
    585: "It's very crowded. Please wait a while and try again.",
    601: commonErrorEn,
    602: commonErrorEn,
    603: commonErrorEn,
    604: "The specified order number is already registered.",
    606: "The specified user ID is not registered.",
    607: commonErrorEn,
    702: "Security code not set",
    830: "The deadline for actual sales processing has passed.",
    904: "You have already paid or this URL is no longer valid.",
    908: commonErrorEn,
    909: commonErrorEn,
    910: commonErrorEn,
    911: "The user ID you are trying to register has already been registered.",
    971: "A network connection error has occurred. Please perform the operation again.",
    C01: "The Epsilon system is unable to communicate with the card company.",
    "C** 注1": "A communication error has occurred. Please perform the operation again.",
    "G** 注1": "The credit card company has refused to approve the card payment.",
    "K** 注1": "There is an error in the entered card information.",
    502: commonErrorEn,
    602: commonErrorEn,
    608: commonErrorEn,
    609: commonErrorEn,
    610: commonErrorEn,
    611: commonErrorEn,
    612: commonErrorEn,
    614: "The order number is invalid.",
    615: "Payment information could not be obtained during 3DS processing.",
    616: "The payment for the target transaction has been completed.",
    617: commonErrorEn,
    618: "The value of expiration date (year) 'expire_y' is set to a value other than 2010 or more and 2099 or less.",
    619: "The value of expiration date (month) 'expire_m' is set to a value other than 1 to 12.",
    620: "The value of payment method 'card_st_code' is set to a value other than 10: lump sum, 61: revolving, 80: split.",
    621: "The value of the number of divisions 'pay_time' is invalid. Only 3, 5, 6, 10, 12, 15, 18, 20, 24 can be set.",
    623: "Can't get 3DS results",
    625: "Unable to register 3DS results",
    626: "Since the target store requires 3DS, payment cannot be made with a credit card that is not registered with 3DS.",
    627: "3DS authentication failed",
    628: "3DS is not available on mobile phones.",
    712: "Revolving or splitting is not available under the contract.",
    801: "Target user is not registered",
    802: "Target user is unavailable",
    810: "There are no transactions for order number 'order_number'.",
    811: commonErrorEn,
    813: commonErrorEn,
    814: commonErrorEn,
    815: commonErrorEn,
    816: "The transaction cannot be confirmed.",
    817: commonErrorEn,
    818: commonErrorEn,
    819: "An error occurred during authorization processing",
    999: "The status of the target transaction is abnormal.",
    E00: "A system error has occurred. Please contact us.",
    E00000001: "A system error has occurred. Please contact us.",
    E00000002: "A system error has occurred. Please contact us.",
    E00000003: "A system error has occurred. Please contact us.",
    E00000010: "A system error has occurred. Please contact us.",
    E01: "A system error has occurred. Please contact us.",
    E01010001: "Shop ID has not been specified.",
    E01010008: "The shop ID contains characters other than half-width alphanumeric characters or exceeds 13 characters.",
    E01010010: "Shop IDs do not match.",
    E01020001: "Shop password has not been specified.",
    E01020008: "The shop password contains characters other than half-width alphanumeric characters or exceeds 10 characters.",
    E01030002: "The shop with the specified ID and password does not exist.",
    E01030061: "Forced returns are not available.",
    E01040001: "Order ID not specified.",
    E01040003: "Order ID exceeds maximum number of characters.",
    E01040010: "Order ID already exists.",
    E01040013: "The order ID contains characters other than half-width alphanumeric characters and '-''.",
    E01050001: "Processing class not specified.",
    E01050002: "The specified processing class is not defined.",
    E01050004: "The process of the specified process category cannot be executed.",
    E01060001: "The usage amount has not been specified.",
    E01060005: "The amount used exceeds the maximum number of digits.",
    E01060006: "The usage amount contains characters other than numbers.",
    E01060010: "The transaction amount and the specified amount do not match.",
    E01060011: "The amount spent exceeds the valid range.",
    E01060021: "The transaction amount and the specified amount do not match.",
    E01070005: "Tax shipping exceeds maximum number of digits.",
    E01070006: "The tax shipping fee contains characters other than numbers.",
    E01080007: "A value other than 0,1,2 is specified for the 3D Secure use flag.",
    E01080010: "The 3D Secure usage flag (TdFlag) specification does not match the 3D Secure contract. *3DS1.0 usage without 3DS1.0 contract. Use of 3DS2.0 with 3DS1.0 contract, etc.",
    E01080101: "The 3D Secure use flag is OFF even though 3DS is required at stores that require 3DS or 3DS is required.",
    E01090001: "Transaction ID not specified.",
    E01090008: "Transaction ID format is incorrect.",
    E01100001: "Transaction password not specified.",
    E01100008: "Transaction password format is incorrect.",
    E01110002: "The transaction with the specified ID and password does not exist.",
    E01110010: "The specified transaction has not been settled.",
    E01130012: "The card company abbreviation exceeds the maximum number of bytes.",
    E01160001: "The number of bonus splits is not specified.",
    E01160007: "The number of bonus divisions contains characters other than numbers.",
    E01160010: "A value other than 2 is specified for the number of bonus divisions.",
    E01170001: "Card number not specified.",
    E01170003: "Card number exceeds maximum number of characters.",
    E01170006: "The card number contains characters other than numbers.",
    E01170011: "The card number is not between 10 and 16 digits.",
    E01180001: "No expiration date specified.",
    E01180003: "The expiration date is not 4 digits.",
    E01180006: "The expiration date contains non-numeric characters.",
    E01180008: "Expiry date format is incorrect.",
    E01180011: "Expiry date format is incorrect.",
    E01190001: "Site ID is not specified.",
    E01190008: "The site ID format is incorrect.",
    E01200001: "No site password specified.",
    E01200007: "Site ID is incorrect.",
    E01200008: "The site password format is incorrect.",
    E01210002: "The site with the specified ID and password does not exist.",
    E01220001: "Member ID has not been specified.",
    E01220005: "Member ID exceeds the maximum number of digits.",
    E01220008: "The format of the member ID is incorrect.",
    E01220010: "Your member ID and card number match.",
    E01220012: "Member ID length is incorrect.",
    E01230001: "Card registration serial number is not specified.",
    E01230006: "The card registration serial number contains characters other than numbers.",
    E01230009: "The card registration serial number exceeds the maximum number that can be registered.",
    E01240002: "The specified card does not exist.",
    E01240012: "The specified member ID is duplicated in the file (*at the time of renewal)",
    E01250008: "The format of the card password is incorrect.",
    E01250010: "Card passwords do not match.",
    E01260001: "No payment method specified.",
    E01260002: "The specified payment method does not exist.",
    E01260010: "The card number or payment method provided is incorrect.",
    E01270001: "No payment frequency specified.",
    E01270005: "The number of payments exceeds the maximum number of digits.",
    E01270006: "Contains characters other than numbers in the number of payments.",
    E01270010: "The specified number of payments cannot be used.",
    E01290001: "HTTP_ACCEPT was not specified.",
    E01300001: "HTTP_USER_AGENT was not specified.",
    E01310001: "A value other than 0 or 1 has been specified for the terminal being used.",
    E01320012: "The value of affiliated store discretionary item 1 exceeds the maximum number of bytes.",
    E01320013: "The value of merchant optional item 1 contains characters that cannot be used.",
    E01330012: "The value of affiliated store discretionary item 2 exceeds the maximum number of bytes.",
    E01330013: "The value of merchant optional item 2 contains characters that cannot be used.",
    E01340012: "The value of affiliated store discretionary item 3 exceeds the maximum number of bytes.",
    E01340013: "The value of merchant optional item 3 contains characters that cannot be used.",
    E01350001: "MD is not specified.",
    E01350008: "MD format is incorrect.",
    E01360001: "PaRes not specified.",
    E01370008: "The format of the 3D secure display store name is incorrect.",
    E01370012: "The value of the 3D secure display store name exceeds the maximum number of bytes.",
    E01390002: "The member with the specified site ID and member ID does not exist.",
    E01390010: "A member with the specified site ID and member ID already exists.",
    E01400007: "A value other than 0 or 1 is specified for the member store free item return flag.",
    E01410010: "The corresponding transaction is prohibited from operation.",
    E01420010: "The temporary sales validity period has expired.",
    E01430010: "The member name and card number match.",
    E01430012: "The member name value exceeds the maximum number of bytes.",
    E01440008: "The format of the renewal/continuous billing flag is incorrect.",
    E01450008: "The format of the product code is incorrect.",
    E01460008: "The format of the security code is incorrect.",
    E01470008: "The format of the card registration sequential number mode is incorrect.",
    E01480008: "The format of the name is incorrect.",
    E01480011: "The maximum number of characters for the holder has been exceeded.",
    E01490005: "The total usage amount, tax and shipping fee exceeds the valid range.",
    E01500001: "Shop information string has not been set.",
    E01500005: "The number of characters in the shop information string is incorrect.",
    E01500012: "The shop information string is inconsistent with other items.",
    E01510001: "Purchasing information string has not been set.",
    E01510005: "The number of characters in the purchasing information string is incorrect.",
    E01510010: "The usage date format is incorrect.",
    E01510011: "The usage date value is outside the specifiable range.",
    E01510012: "Purchasing information string is inconsistent with other items.",
    E01520002: "An invalid value has been set in the customer terminal information.",
    E01530001: "Payment result return destination URL has not been set.",
    E01530005: "The payment result return destination URL exceeds the maximum number of characters.",
    E01540005: "The URL exceeds the maximum number of characters when canceling payment.",
    E01550001: "Date and time information string is not set.",
    E01550005: "The number of characters in the date and time information string is incorrect.",
    E01550006: "Date and time information string contains invalid characters.",
    E01590005: "The product code exceeds the maximum number of digits.",
    E01590006: "Product code contains invalid characters.",
    E01600001: "Member information check string is not set.",
    E01600005: "Member information check string exceeds the maximum number of characters.",
    E01600012: "Member information check string is inconsistent with other items.",
    E01610005: "The number of retries is outside the range of 0 to 99.",
    E01610006: "A value other than a number is set for the number of retries.",
    E01620005: "Session timeout value is outside the range of 0 to 9999.",
    E01620006: "A non-numeric value is set for the session timeout value.",
    E01630010: "When registering the card after a transaction, the member ID of the transaction and the member ID of the parameter do not match.",
    E01640010: "When registering the card after a transaction, the site ID of the transaction and the site ID of the parameter do not match.",
    E01650012: "The specified shop does not belong to the specified site.",
    E01660013: "The language parameter has an unsupported value.",
    E01670013: "Output encoding has an unsupported value.",
    E01700001: "The number of items is incorrect.",
    E01710001: "Transaction classification (continuous billing) has not been set.",
    E01710002: "The specified transaction class does not exist.",
    E01730001: "No bonus amount specified.",
    E01730005: "The bonus amount exceeds the maximum number of digits.",
    E01730006: "The product code is not '0000990'.",
    E01730007: "The bonus amount contains characters other than numbers.",
    E01740001: "Terminal processing sequence number is not specified.",
    E01740005: "The terminal processing sequence number exceeds the maximum number of digits.",
    E01740007: "The terminal processing sequence number contains characters other than numbers.",
    E01750001: "No usage date specified.",
    E01750008: "The usage date format is incorrect.",
    E01770002: "The classification is invalid.",
    E01780002: "Validity check is invalid.",
    E01790007: "The check execution date is invalid.",
    E01790011: "The check execution date exceeds the maximum number of digits.",
    E01800001: "PIN code has not been entered.",
    E01800008: "The format of the PIN number is incorrect.",
    E01800010: "PIN number cannot be used.",
    E01800050: "The PIN number is invalid. (0000 cannot be used)",
    E01810001: "Magnetic stripe classification is invalid.",
    E01810008: "Magnetic stripe classification is invalid.",
    E01820001: "Magnetic stripe information is invalid.",
    E01820003: "Magnetic stripe information is invalid.",
    E01820008: "Magnetic stripe information is invalid.",
    E01840010: "A required input parameter was not specified.",
    E01850008: "The format of the update indicator is incorrect.",
    E01860008: "Card number mask flag format is incorrect.",
    E01870008: "The format of the token type is incorrect.",
    E01880001: "No registered member ID has been specified.",
    E01880002: "The member with the specified site ID and registered member ID does not exist.",
    E01880008: "The format of the registered member ID is incorrect.",
    E01890001: "Registered card registration serial number is not specified.",
    E01890002: "The specified registered card does not exist.",
    E01890006: "The registered card registration serial number contains characters other than numbers.",
    E01890009: "The card registration serial number exceeds the maximum number that can be registered.",
    E01910008: "A value other than 0 or 1 is specified for whether mask level is used in the site settings.",
    E01920008: "Search type format is incorrect.",
    E01950008: "The format for handling when 3DS2.0 is not supported is incorrect.",
    E01960008: "The format of the membership last renewal date is incorrect.",
    E01970008: "The format of the member creation date is incorrect.",
    E01980008: "The format of the member password change date is incorrect.",
    E01990005: "The number of purchases in the past 6 months has exceeded the maximum number of digits.",
    E01990006: "The number of purchases in the past 6 months contains characters other than numbers.",
    E01999998: "001 is not specified in item 1 Format version.",
    E01A00008: "The format of the card registration date is incorrect.",
    E01A10005: "The number of card addition attempts in the past 24 hours exceeds the maximum number of digits.",
    E01A10006: "The number of attempts to add a card in the past 24 hours contains non-numeric characters.",
    E01A20008: "The format of the first use date in the shipping address is incorrect.",
    E01A30008: "The match/mismatch format for cardholder name and shipping name is incorrect.",
    E01A40008: "The format of the card member's suspicious activity information is incorrect.",
    E01A50005: "The number of transactions in the past 24 hours exceeds the maximum number of digits.",
    E01A50006: "The number of transactions in the past 24 hours contains non-numeric characters.",
    E01A60005: "The number of transactions in the previous year exceeds the maximum number of digits.",
    E01A60006: "The number of transactions in the previous year contains characters other than numbers.",
    E01A70012: "Login trail exceeds maximum number of bytes.",
    E01A80008: "The format of the login method is incorrect.",
    E01A90008: "Login date and time format is incorrect.",
    E01B00008: "Billing address and shipping address match/mismatch format is incorrect.",
    E01B10005: "Billing address city exceeds maximum number of digits.",
    E01B20002: "The country code for the billing address does not exist.",
    E01B20005: "The country code in the billing address is not 3 digits.",
    E01B30005: "The first line of the area part of the billing address exceeds the maximum number of digits.",
    E01B40005: "The second line of the area part of the billing address exceeds the maximum number of digits.",
    E01B50005: "The third line of the area part of the billing address exceeds the maximum number of digits.",
    E01B60005: "The billing address zip code exceeds the maximum number of digits.",
    E01B70005: "The state or province number in the billing address exceeds the maximum number of digits.",
    E01B70008: "The state or province number in the billing address is not in the correct format.",
    E01B70010: "If you specify a billing address state or province code, you cannot omit the billing address country code.",
    E01B80005: "The cardholder's email address exceeds the maximum number of digits.",
    E01B80008: "The format of the cardholder's email address is incorrect.",
    E01B90005: "The country code of your home phone exceeds the maximum number of digits.",
    E01C00005: "Home phone number exceeds maximum number of digits.",
    E01C00006: "Your home phone number contains characters other than numbers.",
    E01C10005: "The country code of your mobile phone exceeds the maximum number of digits.",
    E01C20005: "Mobile phone number exceeds maximum number of digits.",
    E01C20006: "The mobile phone number contains characters other than numbers.",
    E01C30005: "The country code on your work phone exceeds the maximum number of digits.",
    E01C40005: "Work phone number exceeds maximum number of digits.",
    E01C40006: "Your work phone number contains non-numeric characters.",
    E01C50005: "The city in the shipping address exceeds the maximum number of digits.",
    E01C60002: "The country code for the shipping address does not exist.",
    E01C60005: "The country code in the shipping address is not 3 digits.",
    E01C70005: "The first line of the area part of the shipping address exceeds the maximum number of digits.",
    E01C80005: "The second line of the area part of the shipping address exceeds the maximum number of digits.",
    E01C90005: "The third line of the area part of the delivery address exceeds the maximum number of digits.",
    E01D00005: "The postal code in the shipping address exceeds the maximum number of digits.",
    E01D10005: "The state or province number in the shipping address is malformed.",
    E01D10008: "The state or province number in the shipping address exceeds the maximum number of digits.",
    E01D10010: "If you specify a state or province code for the shipping address, you cannot omit the country code for the shipping address.",
    E01D20005: "The delivery email address exceeds the maximum number of digits.",
    E01D20008: "The format of the delivery email address is incorrect.",
    E01D30008: "The format of the product delivery time frame is incorrect.",
    E01D40005: "The total purchase amount for prepaid cards or gift cards exceeds the maximum number of digits.",
    E01D40006: "The total purchase amount for a prepaid card or gift card contains non-numeric characters.",
    E01D50005: "The total number of prepaid or gift cards purchased exceeds the maximum number of digits.",
    E01D50006: "The total number of prepaid or gift cards purchased contains non-numeric characters.",
    E01D60005: "The currency code of the prepaid card or gift card purchased is not 3 digits.",
    E01D70008: "The format of the product's expected release date is incorrect.",
    E01D80008: "The format of the product's sales date information is incorrect.",
    E01D90008: "The format of the product order information is incorrect.",
    E01E00008: "The format of the shipping method on the transaction is incorrect.",
    E01E10008: "The format of the recurring billing deadline is incorrect.",
    E01E20005: "The minimum number of billing interval days for continuous billing exceeds the maximum number of digits.",
    E01E20006: "The minimum billing interval days for recurring billing contains characters other than numbers.",
    E01E30001: "Merchant store return URL has not been specified.",
    E01E30005: "The member store return URL exceeds the maximum number of digits.",
    E01E30008: "The format of the member store return URL is incorrect.",
    E01E50001: "Authentication state not specified.",
    E01E50004: "Unable to execute because the authentication status is invalid.",
    E01E50008: "The format of the authentication status is incorrect.",
    E01E70001: "The home phone number specified is incorrect. Either the home phone country code/home phone number cannot be omitted.",
    E01E80001: "The mobile phone number specified is incorrect. You cannot omit either the mobile phone country code/mobile phone number.",
    E01E90001: "The work phone number specified is incorrect. You cannot omit either the country code for the work phone or the work phone number.",
    E01EA0007: "A value other than 1 or 2 is specified for the callback method.",
    E01EA0010: "A value other than 1 or 2 is specified for the callback method.",
    E01EB0001: "3DS2.0 authentication parameters were not specified.",
    E01EB0005: "3DS2.0 authentication parameter exceeds maximum number of digits.",
    E01EB0010: "3DS2.0 authentication parameters are invalid.",
    E01EC0002: "The specified 3DSSDK interface is not defined.",
    E01EE0001: "App ID is not specified.",
    E01EE0008: "The format of the app ID is incorrect.",
    E01EF0001: "3DS2.0 encrypted data is not specified.",
    E01EF0005: "3DS2.0 encrypted data exceeds the maximum number of digits.",
    E01EG0001: "3DS2.0JWS is not specified.",
    E01EG0008: "3DS2.0JWS format is incorrect.",
    E01EV0001: "No maximum timeout specified.",
    E01EV0008: "Maximum timeout format is incorrect.",
    E01EV0006: "Maximum timeout contains non-numeric characters.",
    E01EW0001: "Reference number not specified.",
    E01EW0005: "Reference number exceeds maximum number of digits.",
    E01EX0001: "SDK transaction ID is not specified.",
    E01EX0008: "The format of the SDK transaction ID is incorrect.",
    E01EY0007: "The mobile app mode specification is incorrect.",
    E01EZ0008: "The format of the 3DS required type is incorrect.",
    M01: "This card cannot be used.",
    M01039013: "Merchant free item 1 contains invalid characters.",
    M01040013: "Member store discretion item 2 contains invalid characters.",
    M01041013: "Member store discretion item 3 contains invalid characters.",
    E11: "This card cannot be used.",
    E11010001: "This transaction has already been settled",
    E11010002: "This transaction has not been settled and cannot be changed.",
    E11010003: "This transaction cannot be processed by specified processing category.",
    E11010004: "The specified transaction callback method or mobile app mode is invalid",
    E11010010: "The transaction cannot be processed because it has exceeded 180 days.",
    E11010099: "This card cannot be used.",
    E11010100: "This card cannot be used.",
    E11010999: "This card cannot be used.",
    E11310001: "Link payment cannot be performed for this transaction",
    E11310002: "Link payment cannot be performed for this transaction",
    E11310003: "Link payment cannot be performed for this transaction",
    E11310004: "Link payment cannot be performed for this transaction",
    E11310005: "Members who have already registered a card will not be able to register the card after the transaction.",
    E21: "This card cannot be used.",
    E21030001: "3D secure authentication failed. Please try again from the purchase screen.",
    E21030007: "3D secure authentication failed. Please try again from the purchase screen.",
    E21030201: "Transactions cannot be made with this card. Please use a card that supports 3D Secure authentication.",
    E21030202: "Transactions cannot be made with this card. Please use a card that supports 3D Secure authentication.",
    E21040001: "Support for 3DS1.0 has ended, but transactions have been discontinued as there is no setting for how to handle it after support ends.",
    E21040002: "3DS1.0 is no longer supported and cannot be used.",
    E31: "This card cannot be used.",
    E41: "There is an error in the card number. Please check and enter again",
    E61: "This card cannot be used.",
    E61010001: "Payment processing failed. We apologize for the inconvenience, but please wait for a while and try again from the purchase screen.",
    E61010002: "You used an invalid card or the card number is incorrect.",
    E61010003: "Payment processing failed. We apologize for the inconvenience, but please wait for a while and try again from the purchase screen.",
    E61020001: "The specified payment method has been suspended.",
    E61030001: "Contract details error/Cannot be used with current contract",
    E61040001: "Your current contract does not allow payment processing using a specified card number.",
    E82: "An error occurred while running. Processing not started",
    E90: "Please wait for a while as it is currently being processed.",
    E91: "This card cannot be used.",
    E91099996: "This is an internal system error. Please check the occurrence time and call parameters before contacting us.",
    E91099997: "The requested API does not exist. Please check the URL",
    E91019999: "Payment processing failed. We apologize for the inconvenience, but please wait for a while and try again from the purchase screen.",
    E91020001: "A communication timeout occurred. We apologize for the inconvenience, but please wait for a while and try again from the purchase screen.",
    E91029998: "Payment processing failed. Please contact the store regarding applicable transactions.",
    E91029999: "Payment processing failed. We apologize for the inconvenience, but please wait for a while and try again from the purchase screen.",
    E91060001: "This is an internal system error.Please check the occurrence time and call parameters before contacting us.",
    E91099999: "Payment processing failed. We apologize for the inconvenience, but please wait for a while and try again from the purchase screen.",
    E92: "This card cannot be used.",
    E92000001: "We are currently very busy, so please wait a while and try making the payment again.",
    E92000002: "We are currently very busy, so please wait a while and try making the payment again.",
    EX1: "This card cannot be used.",
    EX1000301: "Payment processing failed. Please enter your card number again",
    EX1000302: "Payment processing failed. Please enter your card number again",
    EX1000303: "Payment processing failed. Please enter your card number again",
    EX1000304: "Payment processing failed. Please enter your card number again",
    M01: "This card cannot be used.",
    M01039013: "Merchant free item 1 contains invalid characters",
    M01040013: "Merchant free item 2 contains invalid characters",
    M01041013: "Merchant free item 3 contains invalid characters",
    C01: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C03: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C12: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C13: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C14: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C15: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C33: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C50: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C51: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C53: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C54: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C55: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C56: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C57: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C58: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C60: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C70: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C71: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C72: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C73: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C74: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C75: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C76: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C77: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    C78: "Payment processing failed. We apologize for the inconvenience, but please wait a while and try again from the purchase screen.",
    G02: "Payment could not be completed due to insufficient card balance.",
    G03: "The payment could not be completed because the card limit was exceeded.",
    G04: "Payment could not be completed due to insufficient card balance.",
    G05: "The payment could not be completed because the card limit was exceeded.",
    G06: "There is insufficient funds in your debit card account.",
    G07: "The payment could not be completed because the card limit was exceeded.",
    G12: "Transactions cannot be made with this card.",
    G22: "Transactions cannot be made with this card.",
    G30: "Transactions cannot be made with this card.",
    G42: "The payment could not be completed because the PIN number was incorrect.",
    G43: "The payment could not be completed because the PIN number was incorrect.",
    G44: "The payment could not be completed because the security code was incorrect.",
    G45: "The payment could not be completed because the security code was not entered.",
    G54: "Transactions cannot be made with this card.",
    G55: "The payment could not be completed because the card limit was exceeded.",
    G56: "Transactions cannot be made with this card.",
    G60: "Transactions cannot be made with this card.",
    G61: "Transactions cannot be made with this card.",
    G65: "The payment could not be completed because the card number was incorrect.",
    G67: "Payment could not be completed because the product code was incorrect.",
    G68: "Payment could not be completed due to an error in the amount.",
    G69: "Payment could not be completed because there was an error in the tax and shipping charges.",
    G70: "Payment could not be completed due to an error in the number of bonuses.",
    G71: "Payment could not be completed due to an error in the bonus month.",
    G72: "Payment could not be completed due to an error in the bonus month.",
    G73: "The payment could not be completed because there was an error in the payment start month.",
    G74: "Payment could not be completed due to an error in the number of divisions.",
    G75: "Payment could not be completed due to an error in the split amount.",
    G76: "Payment could not be completed due to an error in the initial amount.",
    G77: "Payment could not be completed due to an error in the business classification.",
    G78: "Payment could not be completed due to an error in the payment category.",
    G79: "Payment could not be completed due to an error in the inquiry category.",
    G80: "Payment could not be completed due to an error in the cancellation category.",
    G81: "Payment could not be completed due to an error in the cancellation handling category.",
    G83: "Payment could not be completed because the expiration date was incorrect.",
    G84: "Transactions cannot be made with this card.",
    G85: "The payment could not be completed because the account used was unavailable.",
    G91: "Payment could not be completed due to a system failure.",
    G92: "Transactions cannot be made with this card.",
    G95: "Transactions cannot be made with this card.",
    G96: "Transactions cannot be made with this card.",
    G97: "Transactions cannot be made with this card.",
    G98: "Transactions cannot be made with this card.",
    G99: "Transactions cannot be made with this card.",
}

exports.en = en;