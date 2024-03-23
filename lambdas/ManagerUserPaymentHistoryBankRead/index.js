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
        const sql_user_collection_convertable_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS remainingConvertablePoint FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;


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

            const additionalConditionStr = ' userPaymentHistoryStatus IN (1, 2) AND userPaymentHistoryPaymentPattern = 7 ';

            if (where) where += ` AND ${additionalConditionStr}`;
            else where += `WHERE ${additionalConditionStr}`;

            console.log('my where is ', where);
            console.log('my where parameter is ', parameter);
            let orderBy = commonFunctions1.convertToMySQLSort(sort, 'userPaymentHistoryCreatedAt DESC');

            const sql_count = `
            SELECT COUNT(*) AS total_rows FROM (
                SELECT 
                    (${sql_user_point_subquery}) AS userPointNowPoint,  
                    (${sql_user_collection_count}) AS userCollectionCount,
                    (${sql_user_collection_convertable_point}) AS remainingConvertablePoint,
                    COUNT(r.userId) AS referralCount,
                    User.userLanguageId,
                    Language.languageName
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
                ${where}
                GROUP BY userPaymentHistoryId
                ${having}
            ) AS c1`;

            console.log('count sql ', sql_count)
            const [query_result_count] = await mysql_con.query(sql_count, parameter);


            const sql_data = `
                SELECT 
                    userPaymentHistoryId,
                    userPaymentHistoryStatus,
                    userPaymentHistoryMemo,
                    CASE WHEN userPaymentHistoryStatus = 1 THEN '完了' ELSE (CASE WHEN userPaymentHistoryStatus = 2 THEN '振込待ち' ELSE (CASE WHEN userPaymentHistoryStatus = 3 THEN '未決済' ELSE '決済失敗' END) END) END AS userPaymentHistoryStatusCaption,
                    userPaymentHistoryCreatedAt*1000 AS userPaymentHistoryCreatedAt,
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
					userPointLastGachaAt*1000 AS userPointLastGachaAt,
					userPointLastPurchaseAt*1000 AS userPointLastPurchaseAt,
					User.userCreatedAt*1000 AS userCreatedAt,
					User.userLastActiveAt*1000 AS userLastActiveAt,
					User.userLastLoginAt*1000 AS userLastLoginAt,
					User.userUpdatedAt*1000 AS userUpdatedAt,
					(${sql_user_point_subquery}) AS userPointNowPoint,  
					(${sql_user_collection_count}) AS userCollectionCount,
					(${sql_user_collection_convertable_point}) AS remainingConvertablePoint,
					COUNT(r.userId) AS referralCount,
					User.userRegistIPAddress,
					User.userSMSAuthenticatedAt*1000 AS userSMSAuthenticatedAt

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
                pointHistoryPaymentValue,
                pointHistoryPointAt*1000 AS pointHistoryPointAt
            FROM PointHistory
            WHERE pointHistoryUserPaymentHistoryId = ? 
            ORDER BY pointHistoryPointAt DESC`;

            parameter.push(Number(paymentHistoryId));

            const [query_result_data] = await mysql_con.query(sql_data, parameter);

            const sql_data_payment_history = `
            SELECT 
            userPaymentHistoryUserId
            FROM UserPaymentHistory
            WHERE userPaymentHistoryId = ? 
            LIMIT 1`;

            const [query_result_data_payment_history] = await mysql_con.query(sql_data_payment_history, parameter);
            let userIdOfPayee = query_result_data_payment_history[0].userPaymentHistoryUserId;


            const sql_user_point_subquery = `SELECT COALESCE(SUM(pointWalletPoint), 0) AS userPointNowPoint FROM PointWallet WHERE pointWalletUserId = User.userId`;

            const sql_data_user_info = `
            SELECT 
            userCreatedAt*1000 AS userCreatedAt,
            userLastActiveAt*1000 AS userLastActiveAt,
            userPointLastGachaAt*1000 AS userPointLastGachaAt,
            userPointLastPurchaseAt*1000 AS userPointLastPurchaseAt,
            userPointPurchaseCount,
            (${sql_user_point_subquery}) AS currentPoint,
            userPointPurchasePoint,
            userPointPurchaseValue,
            userPointPurchasePointManualBank,
            userPointPurchaseValueManualBank
            FROM User
            left join UserPoint on UserPoint.userPointUserId = User.userId
            WHERE userId = ? 
            LIMIT 1`;

            const [query_result_data_user_info] = await mysql_con.query(sql_data_user_info, [userIdOfPayee]);

            const sql_total_payment_value = `
            SELECT 
                SUM(pointHistoryPaymentValue)
            FROM PointHistory
            WHERE pointHistoryUserPaymentHistoryId = userPaymentHistoryId`;

            const sql_data_payment_history_by_user = `
            SELECT 
            userPaymentHistoryId,
            userPaymentHistoryPaymentPointId,
            userPaymentHistoryCreatedAt*1000 AS userPaymentHistoryCreatedAt,
            pointPrice,
            userPaymentHistoryStatus,
            (${sql_total_payment_value}) AS totalPaymentAmount,
            userPaymentHistoryStatus
            FROM UserPaymentHistory
            left join Point on Point.pointId = UserPaymentHistory.userPaymentHistoryPaymentPointId
            WHERE userPaymentHistoryId = ? AND userPaymentHistoryUserId = ?
            `;

            const [query_result_data_payment_history_all] = await mysql_con.query(sql_data_payment_history_by_user,[paymentHistoryId, userIdOfPayee]);

            const sql_data_shipping_by_user = `
            SELECT 
            userShippingId,
            userShippingName,
            userShippingZipcode,
            userShippingZipcode,
            userShippingAddress,
            userShippingAddress2,
            userShippingAddress3,
            userShippingAddress4,
            userShippingAddress4,
            userShippingTelCountryCode,
            userShippingTelCCValue,
            userShippingTel,
            userShippingPriorityFlag,
            userShippingMemo,
            userShippingCreatedAt*1000 AS userShippingCreatedAt
            FROM UserShipping
            WHERE userShippingUserId = ? order by userShippingPriorityFlag DESC`;

            const [query_result_shipping_history_all] = await mysql_con.query(sql_data_shipping_by_user,[userIdOfPayee]);
            




            response = { 
                records: query_result_data,
                userInfo:query_result_data_user_info,
                paymentHistoryData:query_result_data_payment_history_all,
                shippingData:query_result_shipping_history_all
            }
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