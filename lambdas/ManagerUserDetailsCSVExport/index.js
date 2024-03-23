/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const redis = require("ioredis");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
process.env.TZ = "Asia/Tokyo";
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
    let headers = [];
    let rowData = [];
    const TEMP_FILE_NAME = 'output.csv';

    const { queryStringParameters = null, pathParameters = null } = event || {};
    const { type } = queryStringParameters || {};

    console.log('type', type);

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const { userId = 0 } = pathParameters || {};
        if (!userId) return getResponse({ message: 'UserId not passing' }, 101);

        parameter.push(userId);

        if (
            type == "collection" ||
            type == "shipping_await" ||
            type == "shipping_complete"
        ) {
            let userCollectionStatus = 0;
            if (type == "collection") userCollectionStatus = 1;
            else if (type == "shipping_await") userCollectionStatus = 2;
            else if (type == "shipping_complete") userCollectionStatus = 3;

            let query_result_count = 0;
            let user_collection_query;

            if (type == "shipping_await") {
                user_collection_query = `
                    SELECT 
                        userCollectionRequestAt,
                        itemTranslateName,
                        userCollectionPoint
                    FROM UserCollection
                    JOIN ItemTranslate on itemTranslateItemId = userCollectionItemId AND itemTranslateJpFlag = 1
                    WHERE userCollectionUserId = ? AND (userCollectionStatus = 2 || userCollectionStatus = 5)
                `;

                const [query_result_data] = await mysql_con.query(
                    user_collection_query,
                    parameter
                );

                headers = [
                    { id: 'userCollectionRequestAt', title: '発送申請日時' },
                    { id: 'itemTranslateName', title: 'アイテム' },
                    { id: 'userCollectionPoint', title: 'pt' }
                ];

                rowData = query_result_data.map(x => {
                    const {
                        userCollectionRequestAt,
                        itemTranslateName,
                        userCollectionPoint
                    } = x || {};

                    return {
                        userCollectionRequestAt: unixTimestampToDateFormat(userCollectionRequestAt),
                        itemTranslateName,
                        userCollectionPoint
                    }
                })
            }
            else {
                user_collection_query = `
                    SELECT 
                        userCollectionId,
                        itemTranslateName,
                        userCollectionPoint,
                        userCollectionCreatedAt,
                        userCollectionExpiredAt,
                        userCollectionRequestAt,
                        userCollectionShippedAt
                    FROM UserCollection
                    JOIN ItemTranslate on itemTranslateItemId = userCollectionItemId AND itemTranslateJpFlag = 1
                    WHERE userCollectionUserId = ? AND userCollectionStatus = ?
                `;
            }
            parameter.push(userCollectionStatus);
            const [query_result_data] = await mysql_con.query(
                user_collection_query,
                parameter
            );

            if (type == "collection") {
                headers = [
                    { id: 'userCollectionCreatedAt', title: '獲得日時' },
                    { id: 'userCollectionExpiredAt', title: '発送依頼期限' },
                    { id: 'itemTranslateName', title: 'アイテム' },
                    { id: 'userCollectionPoint', title: 'pt' },
                ];

                rowData = query_result_data.map(x => {
                    const {
                        userCollectionCreatedAt,
                        userCollectionExpiredAt,
                        itemTranslateName,
                        userCollectionPoint
                    } = x || {};

                    return {
                        userCollectionCreatedAt: unixTimestampToDateFormat(userCollectionCreatedAt),
                        userCollectionExpiredAt: unixTimestampToDateFormat(userCollectionExpiredAt),
                        itemTranslateName,
                        userCollectionPoint
                    }
                })
            }
            else if (type == "shipping_complete") {
                headers = [
                    { id: 'userCollectionShippedAt', title: '発送対応日時' },
                    { id: 'itemTranslateName', title: 'アイテム' },
                    { id: 'userCollectionPoint', title: 'pt' },
                ];

                rowData = query_result_data.map(x => {
                    const {
                        userCollectionShippedAt,
                        itemTranslateName,
                        userCollectionPoint
                    } = x || {};

                    return {
                        userCollectionShippedAt: unixTimestampToDateFormat(userCollectionShippedAt),
                        itemTranslateName,
                        userCollectionPoint
                    }
                })
            }
            
        }
        if (type == "present") {
            const user_collection_query = `
                SELECT 
                    userPresentId,
                    presentName,
                    presentPoint,
                    userPresentCreatedAt,
                    userPresentExpiredAt,
                    userPresentUsedAt
                FROM UserPresent
                JOIN Present ON userPresentPresentId = presentId
                WHERE userPresentUserId = ?
            `;

            const [query_result_data] = await mysql_con.query(
                user_collection_query,
                parameter
            );

            headers = [
                { id: 'userPresentCreatedAt', title: '発行日' },
                { id: 'userPresentExpiredAt', title: '使用期限' },
                { id: 'presentName', title: 'プレゼント名' },
                { id: 'presentPoint', title: 'pt' },
                { id: 'userPresentUsedAt', title: '使用日時' },
            ];

            rowData = query_result_data.map(x => {
                const {
                    userPresentCreatedAt,
                    userPresentExpiredAt,
                    presentName,
                    presentPoint,
                    userPresentUsedAt
                } = x || {};

                return {
                    userPresentCreatedAt: unixTimestampToDateFormat(userPresentCreatedAt),
                    userPresentExpiredAt: unixTimestampToDateFormat(userPresentExpiredAt),
                    presentName,
                    presentPoint,
                    userPresentUsedAt: unixTimestampToDateFormat(userPresentUsedAt),
                }
            })
        }
        //stripe
        if (type == 'payment_history') {
            const user_collection_query = `
                SELECT
                    userPaymentHistoryId,
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryStatus,
                    userPaymentHistoryAFCode,
                    userPaymentHistoryInvitationCode,
                    userPaymentHistoryCreatedAt,
                    userPaymentHistoryCardFingerPrint,
                    userPaymentHistoryIPAddress1,
                    userId,
                    userEmail,
                    userSMSTelNo
                FROM UserPaymentHistory
                JOIN User ON userId = userPaymentHistoryUserId
                WHERE userPaymentHistoryUserId = ? AND userPaymentHistoryPaymentPattern = ?
                ORDER BY userPaymentHistoryCreatedAt DESC
                `;

            parameter.push(1);

            const [query_result_data] = await mysql_con.query(
                user_collection_query,
                parameter
            );

            headers = [
                { id: 'userPaymentHistoryCreatedAt', title: '実行日時' },
                { id: 'userPaymentHistoryPaymentPoint', title: 'pt' },
                { id: 'userPaymentHistoryStatus', title: 'ステータス' }
            ];

            rowData = query_result_data.map(x => {
                const {
                    userPaymentHistoryCreatedAt,
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryStatus
                } = x || {};

                return {
                    userPaymentHistoryCreatedAt: unixTimestampToDateFormat(userPaymentHistoryCreatedAt),
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryStatus: getPaymentHistoryStatus('stripe', userPaymentHistoryStatus)
                }
            })
        }
        //epsilon credit card
        if (type == "payment_history_epsilon") {
            const user_collection_query = `
                SELECT
                userPaymentHistoryId,
                userPaymentHistoryPaymentPoint,
                userPaymentHistoryStatus,
                userPaymentHistoryCardNo,
                userPaymentHistoryCardExpired,
                userPaymentHistoryCardCVC,
                userPaymentHistoryCardHolderName,
                userPaymentHistoryIPAddress1,
                userPaymentHistoryIPAddress2,
                userPaymentHistoryIPAddress3,
                userPaymentHistoryCreatedAt,
                userPaymentHistoryPaymentStartedAt,
                userPaymentHistory3DSecureStartedAt,
                userPaymentHistoryPaymentFinishedAt
                FROM UserPaymentHistory
                WHERE userPaymentHistoryUserId = ? AND userPaymentHistoryPaymentPattern = ?
                ORDER BY userPaymentHistoryCreatedAt DESC
            `;

            parameter.push(3);
            const [query_result_data] = await mysql_con.query(
                user_collection_query,
                parameter
            );

            headers = [
                { id: 'userPaymentHistoryCreatedAt', title: '作成日時' },
                { id: 'userPaymentHistoryPaymentStartedAt', title: '開始日時' },
                { id: 'userPaymentHistory3DSecureStartedAt', title: '３D開始日時' },
                { id: 'userPaymentHistoryPaymentFinishedAt', title: '完了日時' },
                { id: 'userPaymentHistoryStatus', title: 'ステータス' },
                { id: 'userPaymentHistoryPaymentPoint', title: '購入pt' },
                { id: 'userPaymentHistoryCardNo', title: 'カード番号' },
                { id: 'userPaymentHistoryCardExpired', title: 'カード有効期限' },
                { id: 'userPaymentHistoryCardCVC', title: 'CVC' },
                { id: 'userPaymentHistoryCardHolderName', title: 'カード名義人' },
                { id: 'userPaymentHistoryIPAddress1', title: 'IP1' },
                { id: 'userPaymentHistoryIPAddress2', title: 'IP2' },
                { id: 'userPaymentHistoryIPAddress3', title: 'IP3' },
            ];

            rowData = query_result_data.map(x => {
                const {
                    userPaymentHistoryCreatedAt,
                    userPaymentHistoryPaymentStartedAt,
                    userPaymentHistory3DSecureStartedAt,
                    userPaymentHistoryPaymentFinishedAt,
                    userPaymentHistoryStatus,
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryCardNo,
                    userPaymentHistoryCardExpired,
                    userPaymentHistoryCardCVC,
                    userPaymentHistoryCardHolderName,
                    userPaymentHistoryIPAddress1,
                    userPaymentHistoryIPAddress2,
                    userPaymentHistoryIPAddress3
                } = x || {};

                return {
                    userPaymentHistoryCreatedAt: unixTimestampToDateFormat(userPaymentHistoryCreatedAt),
                    userPaymentHistoryPaymentStartedAt: unixTimestampToDateFormat(userPaymentHistoryPaymentStartedAt),
                    userPaymentHistory3DSecureStartedAt: unixTimestampToDateFormat(userPaymentHistory3DSecureStartedAt),
                    userPaymentHistoryPaymentFinishedAt: unixTimestampToDateFormat(userPaymentHistoryPaymentFinishedAt),
                    userPaymentHistoryStatus: getPaymentHistoryStatus('epsilon', userPaymentHistoryStatus),
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryCardNo,
                    userPaymentHistoryCardExpired,
                    userPaymentHistoryCardCVC,
                    userPaymentHistoryCardHolderName,
                    userPaymentHistoryIPAddress1,
                    userPaymentHistoryIPAddress2,
                    userPaymentHistoryIPAddress3
                }
            })
        }
        //bankTransfer
        if (type == "payment_history_banktransfer") {
            const user_collection_query = `
                SELECT
                userPaymentHistoryId,
                userPaymentHistoryPaymentPoint,
                SUM(pointHistoryPoint) AS pointHistoryPoint,
                SUM(pointHistoryPaymentValue) AS pointHistoryPaymentValue,
                userPaymentHistoryPayerMail,
                userPaymentHistoryPayerTelNo,
                userPaymentHistoryPayerName,
                userPaymentHistoryIPAddress1,
                userPaymentHistoryPaymentFinishedAt*1000 AS userPaymentHistoryPaymentFinishedAt,
                userPaymentHistoryCreatedAt*1000 AS userPaymentHistoryCreatedAt
                FROM UserPaymentHistory
                LEFT OUTER JOIN PointHistory ON PointHistory.pointHistoryUserPaymentHistoryId = UserPaymentHistory.userPaymentHistoryId
                WHERE userPaymentHistoryUserId = ? AND userPaymentHistoryPaymentPattern = ?
                ORDER BY userPaymentHistoryCreatedAt DESC
            `;

            parameter.push(7);
            const [query_result_data] = await mysql_con.query(
                user_collection_query,
                parameter
            );

            headers = [
                { id: 'userPaymentHistoryCreatedAt', title: '購入日時' },
                { id: 'userPaymentHistoryFinishedAt', title: '支払日時' },
                { id: 'userPaymentHistoryPaymentPoint', title: '購入pt' },
                { id: 'userPaymentHistoryPayerName', title: '決済者名' },
                { id: 'userPaymentHistoryPayerTelNo', title: '決済者電話番号' },
                { id: 'userPaymentHistoryPayerMail', title: '決済者メールアドレス' },
                { id: 'userPaymentHistoryIPAddress1', title: '購入時IP' }
            ];

            rowData = query_result_data.map(x => {
                const {
                    userPaymentHistoryCreatedAt,
                    userPaymentHistoryFinishedAt,
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryPayerName,
                    userPaymentHistoryPayerTelNo,
                    userPaymentHistoryPayerMail,
                    userPaymentHistoryIPAddress1
                } = x || {};

                return {
                    userPaymentHistoryCreatedAt: unixTimestampToDateFormat(userPaymentHistoryCreatedAt),
                    userPaymentHistoryFinishedAt: unixTimestampToDateFormat(userPaymentHistoryFinishedAt),
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryPayerName,
                    userPaymentHistoryPayerTelNo,
                    userPaymentHistoryPayerMail,
                    userPaymentHistoryIPAddress1
                }
            })
        }
        //coupon
        if (type == "coupon") {
            const user_collection_query = `
                SELECT 
                userCouponId,
                couponName,
                couponCode,
                couponPoint,
                userCouponCreatedAt*1000 AS userCouponCreatedAt
                FROM 
                UserCoupon
                JOIN 
                Coupon ON couponId = userCouponCouponId
                WHERE 
                userCouponUserId = ?
                ORDER BY 
                userCouponCreatedAt DESC
            `;

            const [query_result_data] = await mysql_con.query(
                user_collection_query,
                parameter
            );

            headers = [
                { id: 'userCouponCreatedAt', title: '利用日時' },
                { id: 'couponName', title: 'クーポン名' },
                { id: 'couponCode', title: 'クーポンコード' },
                { id: 'couponPoint', title: 'pt' }
            ];

            rowData = query_result_data.map(x => {
                const {
                    userCouponCreatedAt,
                    couponName,
                    couponCode,
                    couponPoint
                } = x || {};

                return {
                    userCouponCreatedAt: unixTimestampToDateFormat(userCouponCreatedAt),
                    couponName,
                    couponCode,
                    couponPoint
                }
            })
        }
        //user friends
        if (type == "user_friends") {
            const user_collection_query = `
                SELECT 
                userId as userFriendUserId,
                userEmail,
                userCreatedAt*1000 AS userCreatedAt,
                userSMSAuthenticatedAt*1000 AS userSMSAuthenticatedAt
                FROM User WHERE 
                userInvitationCode = ?
                ORDER BY 
                userCreatedAt DESC
            `;

            const [query_result_data] = await mysql_con.query(
                user_collection_query,
                parameter
            );

            headers = [
                { id: 'userCreatedAt', title: '登録日時' },
                { id: 'userFriendUserId', title: 'id' },
                { id: 'userEmail', title: 'メールアドレス' },
                { id: 'userSMSAuthenticatedAt', title: 'SMS認証時間' }
            ];

            rowData = query_result_data.map(x => {
                const {
                    userCreatedAt,
                    userFriendUserId,
                    userEmail,
                    userSMSAuthenticatedAt
                } = x || {};

                return {
                    userCreatedAt: unixTimestampToDateFormat(userCreatedAt),
                    userFriendUserId,
                    userEmail,
                    userSMSAuthenticatedAt: unixTimestampToDateFormat(userSMSAuthenticatedAt),
                }
            })
        }
        //shipping address
        if (type == 'shipping_address') {
            const user_collection_query = `
                SELECT 
                    userShippingId,
                    userShippingName,
                    userShippingZipcode,
                    userShippingAddress,
                    userShippingAddress2,
                    userShippingAddress3,
                    userShippingAddress4,
                    userShippingTelCountryCode,
                    userShippingTel,
                    CASE WHEN userShippingPriorityFlag = 1 THEN '○' ELSE '' END AS userShippingPriorityFlag
                FROM UserShipping
                WHERE userShippingUserId = ?
                ORDER BY userShippingCreatedAt DESC
            `;

            const [query_result_data] = await mysql_con.query(user_collection_query, parameter);

            headers = [
                { id: 'userShippingPriorityFlag', title: 'デフォ' },
                { id: 'userShippingName', title: '名前' },
                { id: 'userShippingZipcode', title: '〒' },
                { id: 'userShippingAddress', title: '都道府県' },
                { id: 'userShippingAddress2', title: '市区町村' },
                { id: 'userShippingAddress3', title: '町名・番地' },
                { id: 'userShippingAddress4', title: '建物名/ビル名等' },
                { id: 'userShippingTelCountryCode', title: 'TEL国' },
                { id: 'userShippingTel', title: 'TEL' },
            ];

            rowData = query_result_data.map(x => {
                const {
                    userShippingPriorityFlag,
                    userShippingName,
                    userShippingZipcode,
                    userShippingAddress,
                    userShippingAddress2,
                    userShippingAddress3,
                    userShippingAddress4,
                    userShippingTelCountryCode,
                    userShippingTel
                } = x || {};

                return {
                    userShippingPriorityFlag,
                    userShippingName,
                    userShippingZipcode,
                    userShippingAddress,
                    userShippingAddress2,
                    userShippingAddress3,
                    userShippingAddress4,
                    userShippingTelCountryCode,
                    userShippingTel
                }
            })
        }
        //userSMS
        if (type == 'user_sms') {
            const user_collection_query = `
                SELECT 
                    userSmsHistoryId,
                    userSmsHistoryTellNo,
                    userSmsHistoryTellCountryCode,
                    userSmsHistoryOtp,
                    userSmsHistoryCreatedAt,
                    userSmsHistoryExpiredAt,
                    userSmsHistoryType,
                    CASE WHEN userSmsHistoryStatus = 1 THEN '成功' ELSE '認証失敗' END AS userSmsHistoryStatus
                FROM UserSmsHistory
                WHERE userSmsHistoryUserId = ?
                ORDER BY userSmsHistoryCreatedAt DESC
            `;

            const [query_result_data] = await mysql_con.query(user_collection_query, parameter);

            headers = [
                { id: 'userSmsHistoryType', title: 'タイプ' },
                { id: 'userSmsHistoryStatus', title: '状態' },
                { id: 'userSmsHistoryTellNo', title: 'SMS番号' },
                { id: 'userSmsHistoryTellCountryCode', title: '国番号' },
                { id: 'userSmsHistoryOtp', title: 'OTP' },
                { id: 'userSmsHistoryCreatedAt', title: '作成日時' },
                { id: 'userSmsHistoryExpiredAt', title: '有効日時' }
            ];

            rowData = query_result_data.map(x => {
                const {
                    userSmsHistoryType,
                    userSmsHistoryStatus,
                    userSmsHistoryTellNo,
                    userSmsHistoryTellCountryCode,
                    userSmsHistoryOtp,
                    userSmsHistoryCreatedAt,
                    userSmsHistoryExpiredAt
                } = x || {};

                return {
                    userSmsHistoryType: getSmsHistoryType(userSmsHistoryType),
                    userSmsHistoryStatus,
                    userSmsHistoryTellNo,
                    userSmsHistoryTellCountryCode,
                    userSmsHistoryOtp,
                    userSmsHistoryCreatedAt: unixTimestampToDateFormat(userSmsHistoryCreatedAt),
                    userSmsHistoryExpiredAt: unixTimestampToDateFormat(userSmsHistoryExpiredAt)
                }
            })
        }

        // Define CSV column headers
        const csvWriter = createCsvWriter({
            path: '/tmp/' + TEMP_FILE_NAME, // Lambda function has write access to /tmp directory
            header: headers,
            append: false, // Set append to false to prevent the extra newline
        });

        await csvWriter.writeRecords(rowData);

        // Read the CSV file
        let csvFile = require('fs').readFileSync('/tmp/' + TEMP_FILE_NAME, 'utf-8');

        //For empty records this library generate a \n at the end of the file so remove it manually
        if (rowData.length == 0) {
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

    function getPaymentHistoryStatus(paymentType, status) {
        if (paymentType == 'stripe') {
            switch (status) {
                case 1:
                    return '成功';
                case 3:
                    return '決済開始';
                case 4:
                    return '決済失敗';
                case 9:
                    return 'ブロック済み';
                case 10:
                    return '不信請求';
                case 11:
                    return '返金済み';
            }
        }
        else if (paymentType == 'epsilon') {
            switch (status) {
                case 1:
                    return '成功';
                case 2:
                    return '---';
                case 3:
                    return '作成';
                case 4:
                    return '失敗';
                case 5:
                    return '認証済み';
                case 6:
                    return '認証失敗';
                case 7:
                    return '成功（セキュアなし）';
            }
        }
    }

    function getSmsHistoryType(historyType) {
        switch (historyType) {
            case 1:
                return 'SMS認証';
            case 2:
                return '購入認証';
            case 3:
                return '発送認証';
            case 4:
                return 'SMS認証返信';
            case 5:
                return '購入認証返信';
            case 6:
                return '発送認証返信';
        }
    }
};