/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const redis = require("ioredis");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
process.env.TZ = "Asia/Tokyo";

const commonFunctions = require('./commonFunctions/getWhereFromFilter');
const commonFunctions1 = require('./commonFunctions/convertToMySQLSort');

const mapperKey = {
    userStatus: "User.userStatus",
    userDirectionId: "User.userDirectionId",
    countryName: "User.userCountryId",
    languageName: "Language.languageName",
    userId: "User.userId",
    userEmail: "User.userEmail",
    userSMSFlag: "User.userSMSFlag",
    userBillingFlag: "User.userBillingFlag",
    userTestUserFlag: "User.userTestUserFlag",
    userUUID: "User.userUUID",
    userInvitationCode: "User.userInvitationCode",
    userSMSTelNo: "User.userSMSTelNo",
    userCreatedAt: "User.userCreatedAt",
    userLastActiveAt: "User.userLastActiveAt",
    userLastLoginAt: "User.userLastLoginAt",
    userRegistIPAddress: "User.userRegistIPAddress",
    userSMSAuthenticatedAt: "User.userSMSAuthenticatedAt",

    userShippingName: 'COALESCE(d.userShippingName, a.userShippingName)',
    userShippingZipcode: 'COALESCE(d.userShippingZipcode, a.userShippingZipcode)',
    userShippingAddress: 'COALESCE(d.userShippingAddress, a.userShippingAddress)',
    userShippingAddress2: 'COALESCE(d.userShippingAddress2, a.userShippingAddress2)',
    userShippingAddress3: 'COALESCE(d.userShippingAddress3, a.userShippingAddress3)',
    userShippingAddress4: 'COALESCE(d.userShippingAddress4, a.userShippingAddress4)',
    userShippingTelCountryCode: 'COALESCE(d.userShippingTelCountryCode, a.userShippingTelCountryCode)',
    userShippingTel: 'COALESCE(d.userShippingTel, a.userShippingTel)',
};
const havingKeys = ["userCollectionCount", "remainingConvertablePoint", "userPointNowPoint", "referralCount"];

/**
 * ManagerAppRead.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event) => {
    console.log("Event data:", event);
    // Reading encrypted environment variables --- required
    if (process.env.DBINFO == null) {
        const ssmreq = {
            Name: 'PS_' + process.env.ENV,
            WithDecryption: true
        };
        const ssmparam = await ssm.getParameter(ssmreq).promise();
        const dbinfo = JSON.parse(ssmparam.Parameter.Value);
        process.env.DBWRITEENDPOINT = dbinfo.DBWRITEENDPOINT;
        process.env.DBREADENDPOINT = dbinfo.DBREADENDPOINT;
        process.env.DBUSER = dbinfo.DBUSER;
        process.env.DBPASSWORD = dbinfo.DBPASSWORD;
        process.env.DBDATABSE = dbinfo.DBDATABSE;
        process.env.DBPORT = dbinfo.DBPORT;
        process.env.DBCHARSET = dbinfo.DBCHARSET;
        process.env.DBINFO = true;
        process.env.REDISPOINT1 = dbinfo.REDISPOINT1;
        process.env.REDISPOINT2 = dbinfo.REDISPOINT2;
        process.env.ENVID = dbinfo.ENVID;
    }

    // Database info
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    const ENVID = process.env.ENVID;

    const redisConfig = [
        { host: process.env.REDISPOINT1, port: 6379 },
        { host: process.env.REDISPOINT2, port: 6379 }
    ];
    // ユーザー情報をRedisに書き出す

    const cluster = new redis.Cluster(
        redisConfig,
        {
            dnsLookup: (address, callback) => callback(null, address),
            redisOptions: { tls: true }
        }
    );

    let parameter = [];
    let mysql_con;
    const TEMP_FILE_NAME = 'output.csv';

    const { queryStringParameters = null } = event || {};
    const { filter, sort } = queryStringParameters || {};

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const sql_user_point_subquery = `SELECT COALESCE(SUM(pointWalletPoint), 0) AS userPointNowPoint FROM PointWallet WHERE pointWalletUserId = User.userId`;
        const sql_user_collection_count = `SELECT COUNT(userCollectionId) AS userCollectionCount FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;
        const sql_user_collection_convertable_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS remainingConvertablePoint FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;

        let where = "";
        let having = "";
        console.log("filter", filter);
        if (filter) {
            const {
                condition = "",
                conditionParameters = [],
                havingCondition = "",
                havingConditionParameters = [],
            } = commonFunctions.getWhereFromFilter(filter, mapperKey, havingKeys);

            if (condition) {
                where = condition;
                parameter = [...parameter, ...conditionParameters];
            }

            if (havingCondition) {
                having = havingCondition;
                parameter = [...parameter, ...havingConditionParameters];
            }
        }

        //addWhere userRegistFlag=1 #114023
        if (where) {
            where = `${where} AND User.userRegistFlag = 1`;
        } else {
            where = ` where User.userRegistFlag = 1`;
        }

        console.log("where >>", where);

        let orderBy = commonFunctions1.convertToMySQLSort(sort, "userCreatedAt DESC");

        const sql_data = `
			SELECT
                User.userId,
                User.userStatus,
                User.userDirectionId,
                User.userSMSTelNo,
                User.userSMSFlag,
                User.userCountryId,
                User.userAFCode,
                User.userLanguageId,
                User.userBillingFlag,
                User.userTestUserFlag,
                Language.languageName,
                User.userInvitationCode,
                countryName,
                BIN_TO_UUID(User.userUUID) AS userUUID,
                User.userEmail,
                COALESCE(d.userShippingName, a.userShippingName) AS userShippingName,
            COALESCE(d.userShippingZipcode, a.userShippingZipcode) AS userShippingZipcode,
            COALESCE(d.userShippingAddress, a.userShippingAddress) AS userShippingAddress,
            COALESCE(d.userShippingAddress2, a.userShippingAddress2) AS userShippingAddress2,
            COALESCE(d.userShippingAddress3, a.userShippingAddress3) AS userShippingAddress3,
            COALESCE(d.userShippingAddress4, a.userShippingAddress4) AS userShippingAddress4,
            COALESCE(d.userShippingTelCountryCode, a.userShippingTelCountryCode) AS userShippingTelCountryCode,
            COALESCE(d.userShippingTel, a.userShippingTel) AS userShippingTel,
            userPointUsagePoint,
            userPointExchangePoint,
            userPointPurchasePoint,
            userPointPurchasePointStripeCredit,
            userPointPurchasePointStripeBank,
            userPointPurchasePointEpsilonCredit,
            userPointPurchasePointEpsilonBank,
            userPointPurchasePointEpsilonPaypay,
            userPointPurchasePointPaypay,
            userPointPurchasePointManualBank,
            userPointPurchaseValue,
            userPointPurchaseValueStripeCredit,
            userPointPurchaseValueStripeBank,
            userPointPurchaseValueEpsilonCredit,
            userPointPurchaseValueEpsilonBank,
            userPointPurchaseValueEpsilonPaypay,
            userPointPurchaseValuePaypay,
            userPointPurchaseValueManualBank,
            userPointCouponPoint,
            userPointPresentPoint,
            userPointSystemAdditionPoint,
            userPointSystemSubtractionPoint,
            userPointLostPoint,
            userPointShippingPoint,
            userPointShippingRefundPoint,
            userPointPurchaseCount,
            userPointLastGachaAt,
            userPointLastPurchaseAt,
            User.userCreatedAt,
            User.userLastActiveAt,
            User.userLastLoginAt,
            User.userUpdatedAt,
            (${sql_user_point_subquery}) AS userPointNowPoint,  
            (${sql_user_collection_count}) AS userCollectionCount,
            (${sql_user_collection_convertable_point}) AS remainingConvertablePoint,
            COUNT(r.userId) AS referralCount,
            User.userRegistIPAddress,
            User.userSMSAuthenticatedAt
        FROM User
        LEFT OUTER JOIN Country ON countryId = userCountryId
        LEFT OUTER JOIN (
            SELECT 
                userShippingUserId, 
                userShippingName, 
                userShippingZipcode, 
                userShippingAddress, 
                userShippingAddress2, 
                userShippingAddress3, 
                userShippingAddress4, 
                userShippingTelCountryCode,
                userShippingTel
            FROM UserShipping AS a1
            WHERE userShippingId = (SELECT MAX(userShippingId) FROM UserShipping WHERE a1.userShippingUserId = userShippingUserId)
        ) a ON userId = a.userShippingUserId
        LEFT OUTER JOIN UserShipping d ON userId = d.userShippingUserId AND d.userShippingPriorityFlag = 1
        LEFT OUTER JOIN UserPoint ON userPointUserId = userId
        LEFT OUTER JOIN (SELECT userPaymentHistoryCreatedAt, userPaymentHistoryUserId, ROW_NUMBER() OVER (PARTITION BY userPaymentHistoryUserId ORDER BY userPaymentHistoryCreatedAt DESC) AS latestId FROM UserPaymentHistory) 
            AS paymentView ON userId = userPaymentHistoryUserId AND latestId = 1
        LEFT OUTER JOIN User AS r ON r.userInvitationCode = User.userId
        LEFT OUTER JOIN Language ON languageId = User.userLanguageId
        ${where}
        GROUP BY User.userId
        ${having}
        ${orderBy}
        `;

        console.log("final  sql_data ", sql_data);
        const [query_result_data] = await mysql_con.query(sql_data, parameter);

        const headers = [
            { id: 'userStatus', title: '状態' },
            { id: 'userDirectionId', title: '面' },
            { id: 'countryName', title: '地域' },
            { id: 'userId', title: 'ID' },
            { id: 'referralCount', title: '紹介人数' },
            { id: 'userEmail', title: 'ログインメール' },
            { id: 'userSMSFlag', title: 'SMS認証' },
            { id: 'userSMSTelNo', title: 'SMS' },
            { id: 'userShippingName', title: '送付先[名]' },
            { id: 'userShippingZipcode', title: '送付先[〠]' },
            { id: 'userShippingAddress', title: '送付先[都道府県]' },
            { id: 'userShippingAddress2', title: '送付先[市区町村]' },
            { id: 'userShippingAddress3', title: '送付先[町名・番地]' },
            { id: 'userShippingAddress4', title: '送付先[建物名/ビル名等]' },
            { id: 'userShippingTelCountryCode', title: '送付先[TEL国]' },
            { id: 'userShippingTel', title: '送付先[TEL]' },
            { id: 'userPointNowPoint', title: '保有pt' },
            { id: 'userPointUsagePoint', title: '累計消費pt' },
            { id: 'userPointExchangePoint', title: '累計還元pt' },
            { id: 'userPointPurchasePoint', title: '累計購入pt' },
            { id: 'userPointPurchasePointStripeCredit', title: '累計購入stripeクレジットpt' },
            { id: 'userPointPurchasePointStripeBank', title: '累計購入stripe銀行振込pt' },
            { id: 'userPointPurchasePointEpsilonCredit', title: '累計購入イプシロンクレジットpt' },
            { id: 'userPointPurchasePointEpsilonBank', title: '累計購入イプシロン銀行振込pt' },
            { id: 'userPointPurchasePointEpsilonPaypay', title: '累計購入イプシロンPayPaypt' },
            { id: 'userPointPurchasePointPaypay', title: '累計購入PayPaypt' },
            { id: 'userPointPurchasePointManualBank', title: '累計購入銀行振込pt' },
            { id: 'userPointCouponPoint', title: '累計クーポンpt' },
            { id: 'userPointPresentPoint', title: '累計プレゼントpt' },
            { id: 'userPointSystemAdditionPoint', title: '累計システム加算pt' },
            { id: 'userPointSystemSubtractionPoint', title: '累計システム減算pt' },
            { id: 'userPointLostPoint', title: '累計消失pt' },
            { id: 'userPointShippingPoint', title: '累計発送pt' },
            { id: 'userPointShippingRefundPoint', title: '累計発送還元pt' },
            { id: 'userPointPurchaseCount', title: '累計購入回数' },
            { id: 'userCollectionCount', title: '保有アイテム' },
            { id: 'remainingConvertablePoint', title: 'コレクションpt' },
            { id: 'userPointLastGachaAt', title: '最終パック実行日時' },
            { id: 'userPointLastPurchaseAt', title: '最終決済日時' },
            { id: 'userCreatedAt', title: '登録日時' },
            { id: 'userLastActiveAt', title: 'セッション更新' },
            { id: 'userLastLoginAt', title: '最終ログイン' },
            { id: 'userBillingFlag', title: '課金' },
            { id: 'userUUID', title: 'UUID' },
            { id: 'userRegistIPAddress', title: 'IP' },
            { id: 'userAFCode', title: 'AF' },
            { id: 'userInvitationCode', title: '紹介者コード' },
            { id: 'languageName', title: '言語' },
            { id: 'userSMSAuthenticatedAt', title: 'SMS認証時間' },
            { id: 'userTestUserFlag', title: 'テスト' },
            { id: 'userPointPurchaseValue', title: '累計購入金額' },
            { id: 'userPointPurchaseValueStripeCredit', title: '累計購入stripeクレジット金額' },
            { id: 'userPointPurchaseValueStripeBank', title: '累計購入stripe銀行振込金額' },
            { id: 'userPointPurchaseValueEpsilonCredit', title: '累計購入イプシロンクレジット金額' },
            { id: 'userPointPurchaseValueEpsilonBank', title: '累計購入イプシロン銀行振込金額' },
            { id: 'userPointPurchaseValueEpsilonPaypay', title: '累計購入イプシロンpaypay金額' },
            { id: 'userPointPurchaseValuePaypay', title: '累計購入paypay金額' },
            { id: 'userPointPurchaseValueManualBank', title: '累計購入銀行振込金額' },
        ];

        const data = query_result_data.map(x => {
            const {
                userStatus,
                userDirectionId,
                countryName,
                userId,
                referralCount,
                userEmail,
                userSMSFlag,
                userSMSTelNo,
                userShippingName,
                userShippingZipcode,
                userShippingAddress,
                userShippingAddress2,
                userShippingAddress3,
                userShippingAddress4,
                userShippingTelCountryCode,
                userShippingTel,
                userPointNowPoint,
                userPointUsagePoint,
                userPointExchangePoint,
                userPointPurchasePoint,
                userPointPurchasePointStripeCredit,
                userPointPurchasePointStripeBank,
                userPointPurchasePointEpsilonCredit,
                userPointPurchasePointEpsilonBank,
                userPointPurchasePointEpsilonPaypay,
                userPointPurchasePointPaypay,
                userPointPurchasePointManualBank,
                userPointCouponPoint,
                userPointPresentPoint,
                userPointSystemAdditionPoint,
                userPointSystemSubtractionPoint,
                userPointLostPoint,
                userPointShippingPoint,
                userPointShippingRefundPoint,
                userPointPurchaseCount,
                userCollectionCount,
                remainingConvertablePoint,
                userPointLastGachaAt,
                userPointLastPurchaseAt,
                userCreatedAt,
                userLastActiveAt,
                userLastLoginAt,
                userBillingFlag,
                userUUID,
                userRegistIPAddress,
                userAFCode,
                userInvitationCode,
                languageName,
                userSMSAuthenticatedAt,
                userTestUserFlag,
                userPointPurchaseValue,
                userPointPurchaseValueStripeCredit,
                userPointPurchaseValueStripeBank,
                userPointPurchaseValueEpsilonCredit,
                userPointPurchaseValueEpsilonBank,
                userPointPurchaseValueEpsilonPaypay,
                userPointPurchaseValuePaypay,
                userPointPurchaseValueManualBank,
            } = x || {};

            return {
                userStatus: getLookup('status', userStatus),
                userDirectionId: getLookup('direction', userDirectionId),
                countryName,
                userId,
                referralCount,
                userEmail,
                userSMSFlag: getLookup('smsFlag', userSMSFlag),
                userSMSTelNo,
                userShippingName,
                userShippingZipcode,
                userShippingAddress,
                userShippingAddress2,
                userShippingAddress3,
                userShippingAddress4,
                userShippingTelCountryCode,
                userShippingTel,
                userPointNowPoint,
                userPointUsagePoint,
                userPointExchangePoint,
                userPointPurchasePoint,
                userPointPurchasePointStripeCredit,
                userPointPurchasePointStripeBank,
                userPointPurchasePointEpsilonCredit,
                userPointPurchasePointEpsilonBank,
                userPointPurchasePointEpsilonPaypay,
                userPointPurchasePointPaypay,
                userPointPurchasePointManualBank,
                userPointCouponPoint,
                userPointPresentPoint,
                userPointSystemAdditionPoint,
                userPointSystemSubtractionPoint,
                userPointLostPoint,
                userPointShippingPoint,
                userPointShippingRefundPoint,
                userPointPurchaseCount,
                userCollectionCount,
                remainingConvertablePoint,
                userPointLastGachaAt: unixTimestampToDateFormat(userPointLastGachaAt),
                userPointLastPurchaseAt: unixTimestampToDateFormat(userPointLastPurchaseAt),
                userCreatedAt: unixTimestampToDateFormat(userCreatedAt),
                userLastActiveAt: unixTimestampToDateFormat(userLastActiveAt),
                userLastLoginAt: unixTimestampToDateFormat(userLastLoginAt),
                userBillingFlag: getLookup('billingFlag', userBillingFlag),
                userUUID,
                userRegistIPAddress,
                userAFCode,
                userInvitationCode,
                languageName,
                userSMSAuthenticatedAt: unixTimestampToDateFormat(userSMSAuthenticatedAt),
                userTestUserFlag: getLookup('testUserFlag', userTestUserFlag),
                userPointPurchaseValue,
                userPointPurchaseValueStripeCredit,
                userPointPurchaseValueStripeBank,
                userPointPurchaseValueEpsilonCredit,
                userPointPurchaseValueEpsilonBank,
                userPointPurchaseValueEpsilonPaypay,
                userPointPurchaseValuePaypay,
                userPointPurchaseValueManualBank,
            }
        })

        // Define CSV column headers
        const csvWriter = createCsvWriter({
            path: '/tmp/' + TEMP_FILE_NAME, // Lambda function has write access to /tmp directory
            header: headers,
            append: false, // Set append to false to prevent the extra newline
        });

        await csvWriter.writeRecords(data);

        // Read the CSV file
        let csvFile = require('fs').readFileSync('/tmp/' + TEMP_FILE_NAME, 'utf-8');

        //For empty records this library generate a \n at the end of the file so remove it manually
        if (data.length == 0) {
            csvFile = csvFile.trimRight();
        }

        return getResponse(csvFile, 200, { 'Content-Type': 'text/csv' })

    } catch (error) {
        console.error("error:", error)
        return getResponse(error, 400);
    } finally {
        if (mysql_con) await mysql_con.close();

        try {
            await cluster.disconnect();
        } catch (err) {
            console.log('Error occurred during disconnect cluster')
        }
    }

    function getResponse(data, statusCode = 200, exHeaders = '') {
        let headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
        };

        if (exHeaders) headers = { ...headers, ...exHeaders };

        return {
            statusCode,
            headers,
            body: JSON.stringify(data),
        }
    }

    function unixTimestampToDateFormat(unixTimestamp, time = true) {
        if (unixTimestamp) {
            // Create a Date object from the Unix timestamp
            const date = new Date(unixTimestamp * 1000); // Unix timestamp is in seconds, so multiply by 1000 to convert to milliseconds

            // Extract year, month, day, hour, and minute
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-based, so add 1 and pad with leading zero
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');

            // Format the date as "yyyy/MM/dd HH:mm"
            // let value = `${year}/${month}/${day}`;
            let value = `${year}/${month}/${day}`;
            if (time) {
                value += ` ${hours}:${minutes}`;
            }
            return value;
        } else {
            console.log("invalidUnixTime");
            return "";
        }
    }

    function getLookup(lookupType, value) {
        if (lookupType == 'status') {
            switch (value) {
                case 1:
                    return '有効';
                case 2:
                    return '無効';
            }
        }
        else if (lookupType == 'direction') {
            switch (value) {
                case 1:
                    return '本番';
                case 2:
                    return '裏';
            }
        }
        else if (lookupType == 'smsFlag' || lookupType == 'testUserFlag') {
            switch (value) {
                case 1:
                    return '◯';
                case 0:
                    return '';
            }
        }
        else if (lookupType == 'billingFlag') {
            switch (value) {
                case 1:
                    return '課金可能';
                case 0:
                    return '課金不可';
            }
        }
    }
};