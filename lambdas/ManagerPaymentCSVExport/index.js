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
const jaErrorMessages = require('./ja');

const mapperKey = {
    userPaymentHistoryUserId: "UserPaymentHistory.userPaymentHistoryUserId",
    userStatus: "User.userStatus",
    userDirectionId: "User.userDirectionId",
    countryName: "User.userCountryId",
    userPaymentHistoryStatusCaption: "userPaymentHistoryStatus",
    languageName: "Language.languageName",
    userId: "User.userId",
    userEmail: "User.userEmail",
    userSMSFlag: "User.userSMSFlag",
    userBillingFlag: "User.userBillingFlag",
    userUUID: "User.userUUID",
    userInvitationCode: "User.userInvitationCode",
    userSMSTelNo: "User.userSMSTelNo",
    userCreatedAt: "User.userCreatedAt",
    userLastActiveAt: "User.userLastActiveAt",
    userLastLoginAt: "User.userLastLoginAt",
    userRegistIPAddress: "User.userRegistIPAddress",
    userAFCode: "User.userAFCode",
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
    const { filter, sort, paymentType } = queryStringParameters || {};

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);
        let csvData = [];
        let headers = [];

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

        if (paymentType === 'epsilonCreditCard') {
            const sql_user_pshipping_name_subquery = `SELECT GROUP_CONCAT(userShippingName SEPARATOR ',') AS userShippingName FROM UserShipping WHERE userShippingUserId = User.userId`;
            const sql_user_collection_convertable_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS userCollectionMyCollectionPoint FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;
            const sql_user_collection_request_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS userCollectionRequestPoint FROM UserCollection WHERE userCollectionUserId = User.userId AND (userCollectionStatus = 2 OR userCollectionStatus = 5)`;
            const sql_user_collection_shipping_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS userCollectionShippingPoint FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 3`;

            const additionalConditionStr = ' userPaymentHistoryPaymentPattern = 3 ';
            if (where) where += ` AND ${additionalConditionStr}`;
            else where += `WHERE ${additionalConditionStr}`;

            console.log('my where is ', where);
            console.log('my where parameter is ', parameter);
            let orderBy = commonFunctions1.convertToMySQLSort(sort, 'userPaymentHistoryCreatedAt DESC');

            const sql_data = `
                SELECT 
                    UserPaymentHistory.userPaymentHistoryId,
                    UserPaymentHistory.userPaymentHistoryUserId,
                    UserPaymentHistory.userPaymentHistoryStatus,
                    User.userEmail,
                    CASE WHEN userPaymentHistoryStatus = 1 THEN '決済完了' 
                    WHEN userPaymentHistoryStatus = 3 THEN '決済開始' 
                    WHEN userPaymentHistoryStatus = 4 THEN '3DS失敗' 
                    WHEN userPaymentHistoryStatus = 5 THEN '3DS開始' 
                    WHEN userPaymentHistoryStatus = 6 THEN '認証失敗' 
                    WHEN userPaymentHistoryStatus = 7 THEN '決済完了（3DSなし）' 
                    END AS userPaymentHistoryStatusCaption,
                    UserPaymentHistory.userPaymentHistoryErrorCode,
                    Point.pointPrice,
                    UserPaymentHistory.userPaymentHistoryPaymentPoint,
                    UserPaymentHistory.userPaymentHistoryCreatedAt,
                    UserPaymentHistory.userPaymentHistoryPaymentStartedAt,
                    UserPaymentHistory.userPaymentHistory3DSecureStartedAt,
                    UserPaymentHistory.userPaymentHistoryPaymentFinishedAt,
                    UserPaymentHistory.userPaymentHistoryCardNo,
                    UserPaymentHistory.userPaymentHistoryCardExpired,
                    UserPaymentHistory.userPaymentHistoryCardCVC,
                    UserPaymentHistory.userPaymentHistoryCardHolderName,
                    UserPaymentHistory.userPaymentHistoryCardBrand,
                    UserPaymentHistory.userPaymentHistoryCardCompany,
                    User.userRegistIPAddress,
                    UserPaymentHistory.userPaymentHistoryIPAddress1,
                    UserPaymentHistory.userPaymentHistoryIPAddress2,
                    UserPaymentHistory.userPaymentHistoryIPAddress3,
                    User.userCreatedAt,
                    User.userSMSTelNoFormat,
                    (${sql_user_pshipping_name_subquery}) AS userShippingName,
                    (${sql_user_collection_convertable_point}) AS userCollectionMyCollectionPoint,
                    (${sql_user_collection_request_point}) AS userCollectionRequestPoint,
                    (${sql_user_collection_shipping_point}) AS userCollectionShippingPoint,
                    C1.userCardCommontIPAddressCount,
                    C2.userCardCommonUserIdCount,
                    C3.userCardPaymentPointTotal,
                    C4.userIdCommontIPAddressCount,
                    C5.userIdPaymentTotal,
                    User.userSMSAuthenticatedAt,
                    UserPoint.userPointLastGachaAt,
                    UserPoint.userPointLastPurchaseAt,
                    User.userLastActiveAt
                FROM UserPaymentHistory
                JOIN User ON userPaymentHistoryUserId = User.userId
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
                LEFT OUTER JOIN User AS r ON r.userInvitationCode = User.userId
                LEFT OUTER JOIN Language ON languageId = User.userLanguageId
                LEFT OUTER JOIN Point ON UserPaymentHistory.userPaymentHistoryPaymentPointId = pointId
                LEFT OUTER JOIN (
                    SELECT
                    userPaymentHistoryCardNo,
                    COUNT(userPaymentHistoryCardNo) AS userCardCommontIPAddressCount
                    FROM 
                    (
                    SELECT userPaymentHistoryIPAddress1 AS IP, userPaymentHistoryCardNo FROM UserPaymentHistory WHERE userPaymentHistoryPaymentPattern = 3 AND userPaymentHistoryCardNo IS NOT NULL AND userPaymentHistoryCardNo != '' AND userPaymentHistoryIPAddress1 IS NOT NULL
                    UNION
                    SELECT userPaymentHistoryIPAddress2 AS IP, userPaymentHistoryCardNo FROM UserPaymentHistory WHERE userPaymentHistoryPaymentPattern = 3 AND userPaymentHistoryCardNo IS NOT NULL AND userPaymentHistoryCardNo != '' AND userPaymentHistoryIPAddress2 IS NOT NULL
                    UNION
                    SELECT userPaymentHistoryIPAddress3 AS IP, userPaymentHistoryCardNo FROM UserPaymentHistory WHERE userPaymentHistoryPaymentPattern = 3 AND userPaymentHistoryCardNo IS NOT NULL AND userPaymentHistoryCardNo != '' AND userPaymentHistoryIPAddress3 IS NOT NULL
                    ) AS CountTable
                    GROUP BY userPaymentHistoryCardNo
                ) AS C1 ON UserPaymentHistory.userPaymentHistoryCardNo = C1.userPaymentHistoryCardNo
                LEFT OUTER JOIN (
                    SELECT
                    userPaymentHistoryCardNo,
                    COUNT(distinct userPaymentHistoryUserId) AS userCardCommonUserIdCount
                    FROM 
                    UserPaymentHistory
                    WHERE userPaymentHistoryPaymentPattern = 3 AND userPaymentHistoryCardNo IS NOT NULL AND userPaymentHistoryCardNo != ''
                    GROUP BY userPaymentHistoryCardNo
                ) AS C2 ON UserPaymentHistory.userPaymentHistoryCardNo = C2.userPaymentHistoryCardNo
                LEFT OUTER JOIN (
                    SELECT
                    userPaymentHistoryCardNo,
                    SUM(userPaymentHistoryPaymentPoint) AS userCardPaymentPointTotal
                    FROM 
                    UserPaymentHistory
                    WHERE userPaymentHistoryPaymentPattern = 3 AND (userPaymentHistoryStatus = 1 OR userPaymentHistoryStatus = 7) AND userPaymentHistoryCardNo IS NOT NULL AND userPaymentHistoryCardNo != ''
                    GROUP BY userPaymentHistoryCardNo
                ) AS C3 ON UserPaymentHistory.userPaymentHistoryCardNo = C3.userPaymentHistoryCardNo
                LEFT OUTER JOIN (
                    SELECT
                    userPaymentHistoryUserId,
                    COUNT(userPaymentHistoryUserId) AS userIdCommontIPAddressCount
                    FROM 
                    (
                    SELECT userPaymentHistoryIPAddress1 AS IP, userPaymentHistoryUserId FROM UserPaymentHistory WHERE userPaymentHistoryPaymentPattern = 3 AND userPaymentHistoryIPAddress1 IS NOT NULL
                    UNION
                    SELECT userPaymentHistoryIPAddress2 AS IP, userPaymentHistoryUserId FROM UserPaymentHistory WHERE userPaymentHistoryPaymentPattern = 3 AND userPaymentHistoryIPAddress2 IS NOT NULL
                    UNION
                    SELECT userPaymentHistoryIPAddress3 AS IP, userPaymentHistoryUserId FROM UserPaymentHistory WHERE userPaymentHistoryPaymentPattern = 3 AND userPaymentHistoryIPAddress3 IS NOT NULL
                    ) AS CountTable
                    GROUP BY userPaymentHistoryUserId
                ) AS C4 ON UserPaymentHistory.userPaymentHistoryUserId = C4.userPaymentHistoryUserId
                LEFT OUTER JOIN (
                    SELECT
                    userPaymentHistoryUserId,
                    COUNT(userPaymentHistoryUserId) AS userIdPaymentTotal
                    FROM 
                    UserPaymentHistory
                    WHERE userPaymentHistoryPaymentPattern = 3 AND (userPaymentHistoryStatus = 1 OR userPaymentHistoryStatus = 7)
                    GROUP BY userPaymentHistoryUserId
                ) AS C5 ON UserPaymentHistory.userPaymentHistoryUserId = C5.userPaymentHistoryUserId
                ${where}
                GROUP BY userPaymentHistoryId
                ${having}
                ${orderBy}
            `;

            console.log("final  sql_data ", sql_data);
            const [query_result_data] = await mysql_con.query(sql_data, parameter);

            headers = [
                { id: 'userPaymentHistoryId', title: '注文番号' },
                { id: 'userPaymentHistoryUserId', title: 'ユーザーID' },
                { id: 'userPaymentHistoryStatusCaption', title: '状態' },
                { id: 'userPaymentHistoryErrorCode', title: 'エラーコード' },
                { id: 'userPaymentHistoryErrorMessage', title: 'エラーメッセージ' },
                { id: 'userEmail', title: 'ログインメール' },
                { id: 'pointPrice', title: '購入額' },
                { id: 'userPaymentHistoryPaymentPoint', title: '購入pt' },
                { id: 'userPaymentHistoryCreatedAt', title: '決済開始日時' },
                { id: 'userPaymentHistoryPaymentStartedAt', title: '認証開始日時' },
                { id: 'userPaymentHistory3DSecureStartedAt', title: '3DS開始日時' },
                { id: 'userPaymentHistoryPaymentFinishedAt', title: '決済完了日時' },
                { id: 'userPaymentHistoryCardNo', title: 'カード番号' },
                { id: 'userPaymentHistoryCardExpired', title: '有効期限' },
                { id: 'userPaymentHistoryCardCVC', title: 'CVC' },
                { id: 'userPaymentHistoryCardHolderName', title: '名義人' },
                { id: 'userPaymentHistoryCardBrand', title: 'カードブランド' },
                { id: 'userPaymentHistoryCardCompany', title: 'カード発行会社' },
                { id: 'userRegistIPAddress', title: '登録時IP' },
                { id: 'userPaymentHistoryIPAddress1', title: '決済開始IP' },
                { id: 'userPaymentHistoryIPAddress2', title: '3DS開始IP' },
                { id: 'userPaymentHistoryIPAddress3', title: '決済完了IP' },
                { id: 'userShippingName', title: '配送先氏名' },
                { id: 'userCollectionMyCollectionPoint', title: 'コレクションpt合計' },
                { id: 'userCollectionRequestPoint', title: '発送申請中pt合計' },
                { id: 'userCollectionShippingPoint', title: '発送済みpt合計' },
                { id: 'userCreatedAt', title: 'ユーザー登録日時' },
                { id: 'userSMSTelNoFormat', title: 'SMS' },
                { id: 'userCardCommontIPAddressCount', title: 'カード:IP数' },
                { id: 'userCardCommonUserIdCount', title: 'カード:ユーザー数' },
                { id: 'userCardPaymentPointTotal', title: 'カード:決済総額' },
                { id: 'userIdCommontIPAddressCount', title: 'ID:IP数' },
                { id: 'userIdPaymentCount', title: 'ID:決済数' },
                { id: 'userIdPaymentPointTotal', title: 'ID:決済総額' },
                { id: 'userIdCommonCardCount', title: 'ID:カード数' },
                { id: 'userPointLastGachaAt', title: '最終パック実行日時' },
                { id: 'userPointLastPurchaseAt', title: '最終決済日時' },
                { id: 'userLastActiveAt', title: 'セッション更新日時' },
                { id: 'userSMSAuthenticatedAt', title: 'SMS認証日時' },
            ];

            csvData = query_result_data.map(x => {
                const {
                    userPaymentHistoryId,
                    userPaymentHistoryUserId,
                    userPaymentHistoryStatusCaption,
                    userPaymentHistoryErrorCode,
                    userEmail,
                    pointPrice,
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryCreatedAt,
                    userPaymentHistoryPaymentStartedAt,
                    userPaymentHistory3DSecureStartedAt,
                    userPaymentHistoryPaymentFinishedAt,
                    userPaymentHistoryCardNo,
                    userPaymentHistoryCardExpired,
                    userPaymentHistoryCardCVC,
                    userPaymentHistoryCardHolderName,
                    userPaymentHistoryCardBrand,
                    userPaymentHistoryCardCompany,
                    userRegistIPAddress,
                    userPaymentHistoryIPAddress1,
                    userPaymentHistoryIPAddress2,
                    userPaymentHistoryIPAddress3,
                    userShippingName,
                    userCollectionMyCollectionPoint,
                    userCollectionRequestPoint,
                    userCollectionShippingPoint,
                    userCreatedAt,
                    userSMSTelNoFormat,
                    userCardCommontIPAddressCount,
                    userCardCommonUserIdCount,
                    userCardPaymentPointTotal,
                    userIdCommontIPAddressCount,
                    userIdPaymentCount,
                    userIdPaymentPointTotal,
                    userIdCommonCardCount,
                    userPointLastGachaAt,
                    userPointLastPurchaseAt,
                    userLastActiveAt,
                    userSMSAuthenticatedAt,
                } = x || {};

                return {
                    userPaymentHistoryId,
                    userPaymentHistoryUserId,
                    userPaymentHistoryStatusCaption,
                    userPaymentHistoryErrorCode,
                    userPaymentHistoryErrorMessage: getUserPaymentHistoryErrorMessage(userPaymentHistoryErrorCode),
                    userEmail,
                    pointPrice,
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryCreatedAt: unixTimestampToDateFormat(userPaymentHistoryCreatedAt),
                    userPaymentHistoryPaymentStartedAt: unixTimestampToDateFormat(userPaymentHistoryPaymentStartedAt),
                    userPaymentHistory3DSecureStartedAt: unixTimestampToDateFormat(userPaymentHistory3DSecureStartedAt),
                    userPaymentHistoryPaymentFinishedAt: unixTimestampToDateFormat(userPaymentHistoryPaymentFinishedAt),
                    userPaymentHistoryCardNo,
                    userPaymentHistoryCardExpired,
                    userPaymentHistoryCardCVC,
                    userPaymentHistoryCardHolderName,
                    userPaymentHistoryCardBrand,
                    userPaymentHistoryCardCompany,
                    userRegistIPAddress,
                    userPaymentHistoryIPAddress1,
                    userPaymentHistoryIPAddress2,
                    userPaymentHistoryIPAddress3,
                    userShippingName,
                    userCollectionMyCollectionPoint,
                    userCollectionRequestPoint,
                    userCollectionShippingPoint,
                    userCreatedAt: unixTimestampToDateFormat(userCreatedAt),
                    userSMSTelNoFormat,
                    userCardCommontIPAddressCount,
                    userCardCommonUserIdCount,
                    userCardPaymentPointTotal,
                    userIdCommontIPAddressCount,
                    userIdPaymentCount,
                    userIdPaymentPointTotal,
                    userIdCommonCardCount,
                    userPointLastGachaAt: unixTimestampToDateFormat(userPointLastGachaAt),
                    userPointLastPurchaseAt: unixTimestampToDateFormat(userPointLastPurchaseAt),
                    userLastActiveAt: unixTimestampToDateFormat(userLastActiveAt),
                    userSMSAuthenticatedAt: unixTimestampToDateFormat(userSMSAuthenticatedAt),
                }
            })
        }

        if (paymentType === 'bankTransfer') {
            const sql_user_point_subquery = `SELECT COALESCE(SUM(pointWalletPoint), 0) AS userPointNowPoint FROM PointWallet WHERE pointWalletUserId = User.userId`;
            const sql_user_collection_count = `SELECT COUNT(userCollectionId) AS userCollectionCount FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;
            const sql_user_collection_convertable_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS remainingConvertablePoint FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;

            const additionalConditionStr = ' userPaymentHistoryStatus IN (1, 2) AND userPaymentHistoryPaymentPattern = 7 ';

            if (where) where += ` AND ${additionalConditionStr}`;
            else where += `WHERE ${additionalConditionStr}`;

            console.log('my where is ', where);
            console.log('my where parameter is ', parameter);
            let orderBy = commonFunctions1.convertToMySQLSort(sort, 'userPaymentHistoryCreatedAt DESC');

            const sql_data = `
                SELECT 
                    userPaymentHistoryId,
                    userPaymentHistoryStatus,
                    userPaymentHistoryMemo,
                    CASE WHEN userPaymentHistoryStatus = 1 THEN '完了' ELSE (CASE WHEN userPaymentHistoryStatus = 2 THEN '振込待ち' ELSE (CASE WHEN userPaymentHistoryStatus = 3 THEN '未決済' ELSE '決済失敗' END) END) END AS userPaymentHistoryStatusCaption,
                    userPaymentHistoryCreatedAt,
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryPayerName,
                    userPaymentHistoryPayerTelNo,
                    userPaymentHistoryPayerMail,
                    userPaymentHistoryUserId,

                    User.userId,
					User.userStatus,
					User.userDirectionId,
					User.userSMSTelNo,
					User.userSMSFlag,
					User.userCountryId,
					User.userAFCode,
					User.userLanguageId,
					User.userBillingFlag,
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

                FROM UserPaymentHistory
                JOIN User ON userPaymentHistoryUserId = User.userId
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
				LEFT OUTER JOIN User AS r ON r.userInvitationCode = User.userId
				LEFT OUTER JOIN Language ON languageId = User.userLanguageId
                ${where}
                GROUP BY userPaymentHistoryId
				${having}
                ${orderBy}
            `;

            console.log("final  sql_data ", sql_data);
            const [query_result_data] = await mysql_con.query(sql_data, parameter);

            headers = [
                { id: 'userPaymentHistoryStatusCaption', title: '状態' },
                { id: 'userPaymentHistoryPayerName', title: '振込人名(フルネーム)' },
                { id: 'userPaymentHistoryPayerTelNo', title: 'お客様の電話番号' },
                { id: 'userPaymentHistoryPayerMail', title: 'お客様のメールアドレス' },
                { id: 'userPaymentHistoryPaymentPoint', title: '購入金額' },
                { id: 'userPaymentHistoryCreatedAt', title: '購入日時' },
                { id: 'userStatus', title: 'ユーザー状態' },
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
            ];

            csvData = query_result_data.map(x => {
                const {
                    userPaymentHistoryStatusCaption,
                    userPaymentHistoryPayerName,
                    userPaymentHistoryPayerTelNo,
                    userPaymentHistoryPayerMail,
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryCreatedAt,
                    userStatus,
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
                } = x || {};

                return {
                    userPaymentHistoryStatusCaption,
                    userPaymentHistoryPayerName,
                    userPaymentHistoryPayerTelNo,
                    userPaymentHistoryPayerMail,
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryCreatedAt: unixTimestampToDateFormat(userPaymentHistoryCreatedAt),
                    userStatus: getLookup('status', userStatus),
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
                }
            })
        }

        // Define CSV column headers
        const csvWriter = createCsvWriter({
            path: '/tmp/' + TEMP_FILE_NAME, // Lambda function has write access to /tmp directory
            header: headers,
            append: false, // Set append to false to prevent the extra newline
        });

        await csvWriter.writeRecords(csvData);

        // Read the CSV file
        let csvFile = require('fs').readFileSync('/tmp/' + TEMP_FILE_NAME, 'utf-8');

        //For empty records this library generate a \n at the end of the file so remove it manually
        if (csvData.length == 0) {
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
        else if (lookupType == 'smsFlag') {
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

    function getUserPaymentHistoryErrorMessage(errorCode) {
        if (errorCode) {
            return jaErrorMessages.ja[errorCode] ? jaErrorMessages.ja[errorCode] : "クレジットカードの決済に失敗しました。";
        }
        return null;
    }
};