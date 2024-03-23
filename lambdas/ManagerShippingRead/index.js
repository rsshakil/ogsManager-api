/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const commonFunctions = require('./commonFunctions/getWhereFromFilter');
const commonFunctions1 = require('./commonFunctions/convertToMySQLSort');


const PAGES_VISITED = 0;
const ITEMS_PER_PAGE = 500;

const mapperKey = {
    userId: "User.userId",
    countryName: "User.userCountryId",
    userStatus: "User.userStatus",
    userSMSTelNo: "User.userSMSTelNo",
    userSMSFlag: "User.userSMSFlag",
    userCountryId: "User.userCountryId",
    userEmail: "User.userEmail",
    userDirectionId: "User.userDirectionId",
    userSMSTelNoFormat: "User.userSMSTelNoFormat",
    userSMSTelLanguageCCValue: "User.userSMSTelLanguageCCValue",
    userRegistIPAddress: "User.userRegistIPAddress",
    userCreatedAt: "User.userCreatedAt",
    userLastActiveAt: "User.userLastActiveAt",
    userLastLoginAt: "User.userLastLoginAt",
    userInvitationCode: "User.userInvitationCode",
    itemTags: "itemTagTagId",
}
const havingKeys = [
    "userCollectionCount",
    "remainingConvertablePoint",
    "userPointNowPoint",
    "referralCount",
    "userShippingNameCount",
    "userShippingZipcodeCount",
    "userShippingAddressCount",
    "userCollectionShippingAddress23",
    "userShippingAddress23Count",
    "userShippingTelCount",
    "userRegistIPCount",
    "referralCount",
    "cardHolderName",
];

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

                if (where) where += ` AND userCollectionStatus > ?`;
                else where += ` WHERE userCollectionStatus > ?`;

                parameter.push(1);

                if (havingCondition) {
                    having = havingCondition;
                    parameter = [...parameter, ...havingConditionParameters];
                }
            }
            else {
                where += ` WHERE userCollectionStatus > ?`;
                parameter.push(1);
            }

            console.log('my where is ', where);
            console.log('my where parameter is ', parameter);

            let orderBy = commonFunctions1.convertToMySQLSort(sort, 'userCollectionRequestAt DESC');

            //Sub queries
            const sql_user_point_subquery = `SELECT COALESCE(SUM(pointWalletPoint), 0) AS userPointNowPoint FROM PointWallet WHERE pointWalletUserId = User.userId`;
            const sql_user_collection_count = `SELECT COUNT(userCollectionId) AS userCollectionCount FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;
            const sql_user_collection_convertable_point = `SELECT COALESCE(SUM(userCollectionPoint), 0) AS remainingConvertablePoint FROM UserCollection WHERE userCollectionUserId = User.userId AND userCollectionStatus = 1`;

            // COUNT(*) as total_rows,
            const sql_count = `
            SELECT COUNT(*) AS total_rows FROM 
            (
                SELECT 
                    userCollectionId,
                    r.referralCount,
                    a.userRegistIPCount,
                    b.userShippingTelCount,
                    CONCAT(userCollectionShippingAddress2, userCollectionShippingAddress3) AS userCollectionShippingAddress23,
                    c.userShippingAddress23Count,
                    e.userShippingNameCount,
                    d.userShippingAddressCount,
                    f.userShippingZipcodeCount,
                    g.cardHolderName,
                    (${sql_user_point_subquery}) AS userPointNowPoint,  
                    (${sql_user_collection_count}) AS userCollectionCount,
                    (${sql_user_collection_convertable_point}) AS remainingConvertablePoint
                FROM UserCollection
                JOIN User ON UserCollection.userCollectionUserId = User.userId
                JOIN Item ON UserCollection.userCollectionItemId = Item.itemId
                JOIN ItemTranslate ON Item.itemId = ItemTranslate.itemTranslateItemId AND itemTranslateJpFlag = 1
                LEFT OUTER JOIN ItemTag ON itemId = itemTagItemId
                LEFT OUTER JOIN Language ON languageId = User.userLanguageId
                LEFT OUTER JOIN UserPoint ON userPointUserId = User.userId
                LEFT OUTER JOIN (SELECT userInvitationCode, COUNT(*) AS referralCount FROM User GROUP BY userInvitationCode ) AS r ON r.userInvitationCode = User.userId
                LEFT OUTER JOIN (SELECT userRegistIPAddress, COUNT(*) AS userRegistIPCount FROM User GROUP BY userRegistIPAddress) AS a ON User.userRegistIPAddress = a.userRegistIPAddress
                LEFT OUTER JOIN (SELECT userShippingTelCountryCode, userShippingTel, COUNT(*) AS userShippingTelCount FROM UserShipping GROUP BY userShippingTelCountryCode, userShippingTel) AS b ON userCollectionShippingTel = b.userShippingTel AND userCollectionShippingTelCountryCode = b.userShippingTelCountryCode
                LEFT OUTER JOIN (SELECT userShippingAddress2, userShippingAddress3, COUNT(*) AS userShippingAddress23Count FROM UserShipping GROUP BY userShippingAddress2, userShippingAddress3) AS c ON userCollectionShippingAddress2 = c.userShippingAddress2 AND userCollectionShippingAddress3 = c.userShippingAddress3
                LEFT OUTER JOIN (SELECT userShippingAddress, COUNT(*) AS userShippingAddressCount FROM UserShipping GROUP BY userShippingAddress) AS d ON userCollectionShippingAddress = d.userShippingAddress
                LEFT OUTER JOIN (SELECT userShippingName, COUNT(*) AS userShippingNameCount FROM UserShipping GROUP BY userShippingName) AS e ON userCollectionShippingName = e.userShippingName
                LEFT OUTER JOIN (SELECT userShippingZipcode, COUNT(*) AS userShippingZipcodeCount FROM UserShipping GROUP BY userShippingZipcode) AS f ON userCollectionShippingZipcode = f.userShippingZipcode
                LEFT OUTER JOIN (SELECT userPaymentHistoryUserId, GROUP_CONCAT(userPaymentHistoryCardHolderName) AS cardHolderName FROM UserPaymentHistory GROUP BY userPaymentHistoryUserId) AS g ON User.userId = g.userPaymentHistoryUserId
                ${where}
                GROUP BY userCollectionId
                ${having}
            ) AS c1`;

            const [query_result_count] = await mysql_con.query(sql_count, parameter);

            const sql_data = `
                SELECT 
                    userCollectionId,
                    userCollectionPoint,
                    userCollectionStatus, 
                    userCollectionRequestAt*1000 AS userCollectionRequestAt,
                    userCollectionUpdatedAt*1000 AS userCollectionUpdatedAt,
                    userCollectionShippedAt*1000 AS userCollectionShippedAt,
                    BIN_TO_UUID(userCollectionTransactionUUID) AS userCollectionTransactionUUID,
                    userCollectionShippingName,
                    e.userShippingNameCount,
                    userCollectionShippingZipcode,
                    f.userShippingZipcodeCount,
                    userCollectionShippingAddress,
                    d.userShippingAddressCount,
                    CONCAT(userCollectionShippingAddress2, userCollectionShippingAddress3) AS userCollectionShippingAddress23,
                    c.userShippingAddress23Count,
                    userCollectionShippingAddress4,
                    userCollectionShippingTelCountryCode,
                    userCollectionShippingTel,
                    b.userShippingTelCount,
                    userCollectionCreatedAt*1000 AS userCollectionCreatedAt,

                    User.userId,
                    BIN_TO_UUID(User.userUUID) AS userUUID,
                    User.userStatus,
                    User.userSMSTelNo,
					User.userSMSFlag,
					User.userCountryId,
                    User.userAFCode,
					User.userLanguageId,
					User.userBillingFlag,
					Language.languageName,
					User.userInvitationCode,
                    countryName,
                    User.userEmail,
                    User.userDirectionId,
                    User.userSMSTelNoFormat,
                    User.userSMSTelLanguageCCValue,
                    User.userRegistIPAddress,
                    a.userRegistIPCount,
                    r.referralCount,
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
                    userPointLastGachaAt*1000 AS userPointLastGachaAt,
					userPointLastPurchaseAt*1000 AS userPointLastPurchaseAt,
					User.userCreatedAt*1000 AS userCreatedAt,
					User.userLastActiveAt*1000 AS userLastActiveAt,
					User.userLastLoginAt*1000 AS userLastLoginAt,
                    User.userSMSAuthenticatedAt*1000 AS userSMSAuthenticatedAt,
                    (${sql_user_point_subquery}) AS userPointNowPoint,  
                    (${sql_user_collection_count}) AS userCollectionCount,
                    (${sql_user_collection_convertable_point}) AS remainingConvertablePoint,
                    itemTranslateName,
                    itemAttribute3,
                    GROUP_CONCAT(tagName) as itemTags,
                    g.cardHolderName
                FROM UserCollection
                JOIN User ON UserCollection.userCollectionUserId = User.userId
                JOIN Item ON UserCollection.userCollectionItemId = Item.itemId
                JOIN ItemTranslate ON Item.itemId = ItemTranslate.itemTranslateItemId AND itemTranslateJpFlag = 1
                LEFT OUTER JOIN ItemTag ON itemId = itemTagItemId
                LEFT OUTER JOIN Tag ON ItemTag.itemTagTagId = Tag.tagId
                JOIN Country ON countryId = userCountryId
                LEFT OUTER JOIN Language ON languageId = User.userLanguageId
                LEFT OUTER JOIN UserPoint ON userPointUserId = User.userId
                LEFT OUTER JOIN (SELECT userInvitationCode, COUNT(*) AS referralCount FROM User GROUP BY userInvitationCode ) AS r ON r.userInvitationCode = User.userId
                LEFT OUTER JOIN (SELECT userRegistIPAddress, COUNT(*) AS userRegistIPCount FROM User GROUP BY userRegistIPAddress) AS a ON User.userRegistIPAddress = a.userRegistIPAddress
                LEFT OUTER JOIN (SELECT userShippingTelCountryCode, userShippingTel, COUNT(*) AS userShippingTelCount FROM UserShipping GROUP BY userShippingTelCountryCode, userShippingTel) AS b ON userCollectionShippingTel = b.userShippingTel AND userCollectionShippingTelCountryCode = b.userShippingTelCountryCode
                LEFT OUTER JOIN (SELECT userShippingAddress2, userShippingAddress3, COUNT(*) AS userShippingAddress23Count FROM UserShipping GROUP BY userShippingAddress2, userShippingAddress3) AS c ON userCollectionShippingAddress2 = c.userShippingAddress2 AND userCollectionShippingAddress3 = c.userShippingAddress3
                LEFT OUTER JOIN (SELECT userShippingAddress, COUNT(*) AS userShippingAddressCount FROM UserShipping GROUP BY userShippingAddress) AS d ON userCollectionShippingAddress = d.userShippingAddress
                LEFT OUTER JOIN (SELECT userShippingName, COUNT(*) AS userShippingNameCount FROM UserShipping GROUP BY userShippingName) AS e ON userCollectionShippingName = e.userShippingName
                LEFT OUTER JOIN (SELECT userShippingZipcode, COUNT(*) AS userShippingZipcodeCount FROM UserShipping GROUP BY userShippingZipcode) AS f ON userCollectionShippingZipcode = f.userShippingZipcode
                LEFT OUTER JOIN (SELECT userPaymentHistoryUserId, GROUP_CONCAT(userPaymentHistoryCardHolderName) AS cardHolderName FROM UserPaymentHistory GROUP BY userPaymentHistoryUserId) AS g ON User.userId = g.userPaymentHistoryUserId
                ${where}
                GROUP BY userCollectionId
                ${having}
                ${orderBy}
                LIMIT ?, ?`;

            parameter.push(Number(offset));
            parameter.push(Number(limit));

            console.log('sql_data >>>>>', sql_data)

            const [query_result_data, query_fields_data] = await mysql_con.query(sql_data, parameter);

            response = {
                count: query_result_count[0]?.total_rows,
                records: query_result_data
            }
        }
        //get detail
        else if (pathParameters !== null) {
            const { shippingId = 0 } = pathParameters || {};

            //Subquery to get itemTags id in array
            const item_tags_subquery = `
             SELECT 
                GROUP_CONCAT(tagName SEPARATOR ',') AS tagName
             FROM ItemTag
             JOIN Tag ON tagId = itemTagTagId
             WHERE ItemTag.itemTagItemId = Item.itemId`;

            const sql_data = `
                SELECT 
                    userEmail,
                    userCollectionId,
                    userCollectionStatus, 
                    userCollectionRequestAt,
                    BIN_TO_UUID(User.userUUID) AS userUUID,
                    BIN_TO_UUID(userCollectionTransactionUUID) AS userCollectionTransactionUUID,
                    userCollectionMemo,
                    itemTranslateName,
                    itemTranslateDescription1,
                    itemTranslateDescription2,
                    itemImagePath1,
                    itemImagePath2,
                    itemImagePath3,
                    itemAttribute1,
                    itemAttribute2,
                    itemAttribute3,
                    itemAttribute4,
                    itemAttribute5,
                    itemAttribute6,
                    itemAttribute7,
                    itemAttribute8,
                    itemMemo,
                    categoryTranslateName, 
                    (${item_tags_subquery}) AS tagName,
                    userCollectionShippingId AS userShippingId,
                    userCollectionShippingName AS userShippingName,
                    userCollectionShippingZipcode AS userShippingZipcode,
                    userCollectionShippingAddress AS userShippingAddress,
                    userCollectionShippingAddress2 AS userShippingAddress2,
                    userCollectionShippingAddress3 AS userShippingAddress3,
                    userCollectionShippingAddress4 AS userShippingAddress4,
                    userCollectionShippingTelCountryCode AS userShippingTelCountryCode,
                    userCollectionShippingTel AS userShippingTel
                FROM UserCollection
                JOIN User ON UserCollection.userCollectionUserId = User.userId
                JOIN Item ON UserCollection.userCollectionItemId = Item.itemId
                JOIN ItemTranslate ON Item.itemId = ItemTranslate.itemTranslateItemId AND itemTranslateJpFlag = 1
                JOIN CategoryTranslate ON Item.itemCategoryId = CategoryTranslate.categoryTranslateCategoryId AND categoryTranslateJpFlag = 1
                WHERE userCollectionId = ?
                LIMIT 0, 1`;

            parameter.push(Number(shippingId));

            const [query_result_data] = await mysql_con.query(sql_data, parameter);

            if (query_result_data.length > 0) response = { records: query_result_data[0] }
            else response = { message: 'no data' };
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