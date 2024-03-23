/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const commonFunctions = require('./commonFunctions/getWhereFromFilter');
const commonFunctions1 = require('./commonFunctions/convertToMySQLSort');
const ssm = new AWS.SSM();

const PAGES_VISITED = 0;
const ITEMS_PER_PAGE = 500;

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
    }

    // Database info
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    let parameter = [];
    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const { queryStringParameters = null, pathParameters = null } = event || {};

        const sql_user_point_subquery = `SELECT COALESCE(SUM(pointWalletPoint), 0) AS userPointNowPoint FROM PointWallet WHERE pointWalletUserId = User.userId`;
        const sql_user_collection_count = `SELECT COUNT(userCollectionId) AS userCollectionCount FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;
        const sql_user_pshipping_name_subquery = `SELECT GROUP_CONCAT(userShippingName SEPARATOR ',') AS userShippingName FROM UserShipping WHERE userShippingUserId = User.userId`;
        const sql_user_collection_convertable_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS userCollectionMyCollectionPoint FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;
        const sql_user_collection_request_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS userCollectionRequestPoint FROM UserCollection WHERE userCollectionUserId = User.userId AND (userCollectionStatus = 2 OR userCollectionStatus = 5)`;
        const sql_user_collection_shipping_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS userCollectionShippingPoint FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 3`;
        // const sqlUserCardCommonIP1Subquery = `SELECT COUNT(userPaymentHistoryIPAddress1) AS userCardCommontIPAddress1Count FROM UserPaymentHistory WHERE userPaymentHistoryUserId = User.userId GROUP BY userPaymentHistoryCardNo`;


        //get list
        if (pathParameters === null) {
            const { skip: offset = PAGES_VISITED, take: limit = ITEMS_PER_PAGE, filter, sort } = queryStringParameters || {};

            let where = '';
            let having = '';

            if (filter) {
                const { condition = '', conditionParameters = [], havingCondition = '', havingConditionParameters = [] } = commonFunctions.getWhereFromFilter(filter, mapperKey, havingKeys);

                if (condition) {
                    where = condition;
                    parameter = [...parameter, ...conditionParameters];
                }

                if (havingCondition) {
                    having = havingCondition;
                    parameter = [...parameter, ...havingConditionParameters];
                }
            }

            const additionalConditionStr = ' userPaymentHistoryPaymentPattern = 3 ';

            if (where) where += ` AND ${additionalConditionStr}`;
            else where += `WHERE ${additionalConditionStr}`;

            console.log('my where is ', where);
            console.log('my where parameter is ', parameter);
            let orderBy = commonFunctions1.convertToMySQLSort(sort, 'userPaymentHistoryCreatedAt DESC');

            const sql_count = `
            SELECT COUNT(*) AS total_rows FROM (
                SELECT 
                    (${sql_user_pshipping_name_subquery}) AS userShippingName,
                    (${sql_user_collection_convertable_point}) AS userCollectionMyCollectionPoint,
                    (${sql_user_collection_request_point}) AS userCollectionRequestPoint,
                    (${sql_user_collection_shipping_point}) AS userCollectionShippingPoint,
                    COUNT(r.userId) AS referralCount,
                    User.userLanguageId,
                    Language.languageName,
                    C1.userCardCommontIPAddressCount,
                    C2.userCardCommonUserIdCount,
                    C3.userCardPaymentPointTotal,
                    C4.userIdCommontIPAddressCount,
                    C5.userIdPaymentCount,
                    C6.userIdPaymentPointTotal,
                    C7.userIdCommonCardNoCount
                FROM UserPaymentHistory
                JOIN User ON userPaymentHistoryUserId = User.userId
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
                LEFT OUTER JOIN UserShipping d ON User.userId = d.userShippingUserId AND d.userShippingPriorityFlag = 1
                LEFT OUTER JOIN UserPoint ON userPointUserId = User.userId
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
                    COUNT(userPaymentHistoryUserId) AS userIdPaymentCount
                    FROM 
                    UserPaymentHistory
                    WHERE (userPaymentHistoryStatus = 1 OR userPaymentHistoryStatus = 7)
                    GROUP BY userPaymentHistoryUserId
                ) AS C5 ON UserPaymentHistory.userPaymentHistoryUserId = C5.userPaymentHistoryUserId
                LEFT OUTER JOIN (
                    SELECT
                    userPaymentHistoryUserId,
                    SUM(pointPrice) AS userIdPaymentPointTotal
                    FROM 
                    UserPaymentHistory
                    INNER JOIN Point ON UserPaymentHistory.userPaymentHistoryPaymentPointId = Point.pointId
                    WHERE (userPaymentHistoryStatus = 1 OR userPaymentHistoryStatus = 7)
                    GROUP BY userPaymentHistoryUserId
                ) AS C6 ON UserPaymentHistory.userPaymentHistoryUserId = C6.userPaymentHistoryUserId
                LEFT OUTER JOIN (
                    SELECT
                    userPaymentHistoryUserId,
                    COUNT(DISTINCT userPaymentHistoryCardNo) AS userIdCommonCardNoCount
                    FROM 
                    UserPaymentHistory
                    WHERE userPaymentHistoryCardNo != ''
                    GROUP BY userPaymentHistoryUserId
                ) AS C7 ON UserPaymentHistory.userPaymentHistoryUserId = C7.userPaymentHistoryUserId
                ${where}
                GROUP BY userPaymentHistoryId
                ${having}
            ) AS c1`;

            console.log('count sql ', sql_count)
            const [query_result_count] = await mysql_con.query(sql_count, parameter);


            const sql_data = `
                SELECT 
                    UserPaymentHistory.userPaymentHistoryId,
                    UserPaymentHistory.userPaymentHistoryUserId,
                    UserPaymentHistory.userPaymentHistoryStatus,
                    User.userEmail,
                    User.userId,
                    CASE WHEN userPaymentHistoryStatus = 1 THEN '決済完了' 
                    WHEN userPaymentHistoryStatus = 3 THEN '決済開始' 
                    WHEN userPaymentHistoryStatus = 4 THEN '3DS失敗' 
                    WHEN userPaymentHistoryStatus = 5 THEN '3DS開始' 
                    WHEN userPaymentHistoryStatus = 6 THEN '認証失敗' 
                    WHEN userPaymentHistoryStatus = 7 THEN '決済完了（3DSなし）' 
                    WHEN userPaymentHistoryStatus = 8 THEN 'トークンエラー' 
                    END AS userPaymentHistoryStatusCaption,
                    UserPaymentHistory.userPaymentHistoryErrorCode,
                    Point.pointPrice,

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
					(${sql_user_point_subquery}) AS userPointNowPoint,  
					(${sql_user_collection_count}) AS userCollectionCount,
					(${sql_user_collection_convertable_point}) AS remainingConvertablePoint,

                    UserPaymentHistory.userPaymentHistoryPaymentPoint,
                    UserPaymentHistory.userPaymentHistoryCreatedAt * 1000 AS userPaymentHistoryCreatedAt,
                    UserPaymentHistory.userPaymentHistoryPaymentStartedAt * 1000 AS userPaymentHistoryPaymentStartedAt,
                    UserPaymentHistory.userPaymentHistory3DSecureStartedAt * 1000 AS userPaymentHistory3DSecureStartedAt,
                    UserPaymentHistory.userPaymentHistoryPaymentFinishedAt * 1000 AS userPaymentHistoryPaymentFinishedAt,
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
                    User.userCreatedAt * 1000 AS userCreatedAt,
                    User.userSMSTelNoFormat,
                    (${sql_user_pshipping_name_subquery}) AS userShippingName,
                    (${sql_user_collection_convertable_point}) AS userCollectionMyCollectionPoint,
                    (${sql_user_collection_request_point}) AS userCollectionRequestPoint,
                    (${sql_user_collection_shipping_point}) AS userCollectionShippingPoint,
                    C1.userCardCommontIPAddressCount,
                    C2.userCardCommonUserIdCount,
                    C3.userCardPaymentPointTotal,
                    C4.userIdCommontIPAddressCount,
                    C5.userIdPaymentCount,
                    C6.userIdPaymentPointTotal,
                    C7.userIdCommonCardNoCount,
					User.userSMSAuthenticatedAt*1000 AS userSMSAuthenticatedAt,
                    UserPoint.userPointLastGachaAt * 1000 AS userPointLastGachaAt,
                    UserPoint.userPointLastPurchaseAt * 1000 AS userPointLastPurchaseAt,
                    User.userLastActiveAt * 1000 AS userLastActiveAt
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
                    COUNT(userPaymentHistoryUserId) AS userIdPaymentCount
                    FROM 
                    UserPaymentHistory
                    WHERE (userPaymentHistoryStatus = 1 OR userPaymentHistoryStatus = 7)
                    GROUP BY userPaymentHistoryUserId
                ) AS C5 ON UserPaymentHistory.userPaymentHistoryUserId = C5.userPaymentHistoryUserId
                LEFT OUTER JOIN (
                    SELECT
                    userPaymentHistoryUserId,
                    SUM(pointPrice) AS userIdPaymentPointTotal
                    FROM 
                    UserPaymentHistory
                    INNER JOIN Point ON UserPaymentHistory.userPaymentHistoryPaymentPointId = Point.pointId
                    WHERE (userPaymentHistoryStatus = 1 OR userPaymentHistoryStatus = 7)
                    GROUP BY userPaymentHistoryUserId
                ) AS C6 ON UserPaymentHistory.userPaymentHistoryUserId = C6.userPaymentHistoryUserId
                LEFT OUTER JOIN (
                    SELECT
                    userPaymentHistoryUserId,
                    COUNT(DISTINCT userPaymentHistoryCardNo) AS userIdCommonCardNoCount
                    FROM 
                    UserPaymentHistory
                    WHERE userPaymentHistoryCardNo != ''
                    GROUP BY userPaymentHistoryUserId
                ) AS C7 ON UserPaymentHistory.userPaymentHistoryUserId = C7.userPaymentHistoryUserId
                ${where}
                GROUP BY userPaymentHistoryId
				${having}
                ${orderBy}
                LIMIT ?, ?`;

            parameter.push(Number(offset));
            parameter.push(Number(limit));

            console.log('final  sql_data ', sql_data)
            const [query_result_data] = await mysql_con.query(sql_data, parameter);

            response = {
                count: query_result_count[0]?.total_rows,
                records: query_result_data,
            }
        }
        //get detail
        else if (pathParameters !== null) {
            const { paymentHistoryId = 0 } = pathParameters || {};

            const sql_data = `
            SELECT 
                pointHistoryId,
                pointHistoryPoint,
                pointHistoryPointAt*1000 AS pointHistoryPointAt
            FROM PointHistory
            WHERE pointHistoryUserPaymentHistoryId = ? 
            ORDER BY pointHistoryPointAt DESC`;

            parameter.push(Number(paymentHistoryId));

            const [query_result_data] = await mysql_con.query(sql_data, parameter);

            response = { records: query_result_data }
        }

        console.log('my response', response)
        return getResponse(response, 200);

    } catch (error) {
        console.error("error:", error)
        return getResponse(error, 400);
    } finally {
        if (mysql_con) await mysql_con.close();
    }

    function getResponse(data, statusCode = 200) {
        return {
            statusCode,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(data),
        }
    }
};