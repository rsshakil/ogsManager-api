/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const { v4: uuidv4 } = require("uuid");
const redis = require('ioredis');

process.env.TZ = "Asia/Tokyo";

const sqs = new AWS.SQS();
const queueUrl = `https://sqs.ap-northeast-1.amazonaws.com/225702177590/PointSQS-${process.env.ENV}.fifo`;

/**
 * ManagerUserPointHistoryCreate.
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

    const ENVID = process.env.ENVID;

    // Database info
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    const redisConfig = [
        { host: process.env.REDISPOINT1, port: 6379 },
        { host: process.env.REDISPOINT2, port: 6379 },
    ];
    const cluster = new redis.Cluster(redisConfig, {
        dnsLookup: (address, callback) => callback(null, address),
        redisOptions: { tls: true },
    });

    let {
        pointHistoryPoint,
        pointHistoryPaymentValue,
        pointHistoryUserId,
        pointHistoryUserPaymentHistoryId,
        userPaymentHistoryMemo = null,
        userPaymentHistoryStatus,
    } = JSON.parse(event.body);

    let mysql_con;
    let response = {};

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        if (userPaymentHistoryStatus!=3 && (pointHistoryPoint != 0 || pointHistoryPaymentValue != 0)) {
            //Add point to redis
            const redisKey = "user:" + ENVID + ":" + pointHistoryUserId + ":pt";
            const myPoint = await cluster.get(redisKey) || 0;
            await cluster.set(redisKey, Number(myPoint) + Number(pointHistoryPoint));

            const sqsParams = {
                MessageBody: JSON.stringify({
                    userId: pointHistoryUserId,
                    point: pointHistoryPoint,
                    paymentValue: pointHistoryPaymentValue,
                    detailStatus: 1,
                    paymentPattern: 7,
                    paymentFinalize: (userPaymentHistoryStatus == 1),
                    paymentHistoryId: pointHistoryUserPaymentHistoryId,
                    executeAt: Math.floor(new Date().getTime() / 1000)
                }),
                QueueUrl: queueUrl,
                MessageGroupId: "POINTSQS_EXECUTE",
                MessageDeduplicationId: uuidv4(),
            };
            const sqsResult = await sqs.sendMessage(sqsParams).promise();
            if (!sqsResult) {
                console.error("SQS発行エラー");
                res.sendStatus(400);
            }
        }

        const now = Math.floor(new Date().getTime() / 1000);

        if(userPaymentHistoryStatus!=3){
            let update_sql = `UPDATE UserPaymentHistory SET userPaymentHistoryMemo = ?`;
            const updateParams = [userPaymentHistoryMemo];

            //If finilize then change the status 2 -> 1
            if (userPaymentHistoryStatus == 1) {
                update_sql += `, userPaymentHistoryStatus = 1`;
                update_sql += `, userPaymentHistoryPaymentFinishedAt = ?`;

                updateParams.push(now);

                const userPointUpdateSql = `UPDATE UserPoint SET userPointLastPurchaseAt = ?, userPointPurchaseCount = userPointPurchaseCount + 1 WHERE userPointUserId = ?`;
                await mysql_con.execute(userPointUpdateSql, [now, pointHistoryUserId]);
            }

            update_sql += ` WHERE userPaymentHistoryId = ?`;
            updateParams.push(pointHistoryUserPaymentHistoryId);

            await mysql_con.execute(update_sql, updateParams);
        }

        //duplicate pointHistory for number 3 button #114356
        if(userPaymentHistoryStatus==3){
            //duplicateUserPaymentHistory
            let dup_sql = `INSERT INTO UserPaymentHistory
                (
                    userPaymentHistoryUserId,
                    userPaymentHistoryCreatedAt,
                    userPaymentHistoryPaymentPointId,
                    userPaymentHistoryPaymentPoint,
                    userPaymentHistoryPaymentIntent,
                    userPaymentHistoryAFCode,
                    userPaymentHistoryInvitationCode,
                    userPaymentHistoryStatus,
                    userPaymentHistoryPaymentPattern,
                    userPaymentHistoryPayerName,
                    userPaymentHistoryPayerTelNo,
                    userPaymentHistoryPayerMail,
                    userPaymentHistoryCardNo,
                    userPaymentHistoryCardExpired,
                    userPaymentHistoryCardCVC,
                    userPaymentHistoryCardHolderName,
                    userPaymentHistoryCardBrand,
                    userPaymentHistoryCardCompany,
                    userPaymentHistoryCardFingerPrint,
                    userPaymentHistoryPayerZipcode,
                    userPaymentHistoryPayerAddress,
                    userPaymentHistoryIPAddress1,
                    userPaymentHistoryIPAddress2,
                    userPaymentHistoryIPAddress3,
                    userPaymentHistoryIPAddress4,
                    userPaymentHistoryIPAddress5,
                    userPaymentHistoryIPAddress6,
                    userPaymentHistoryIPAddress7,
                    userPaymentHistoryIPAddress8,
                    userPaymentHistoryPaymentStartedAt,
                    userPaymentHistory3DSecureStartedAt,
                    userPaymentHistoryPaymentFinishedAt,
                    userPaymentHistoryErrorCode,
                    userPaymentHistoryTrackingData,
                    userPaymentHistoryTrackingData2,
                    userPaymentHistoryUserAgent1,
                    userPaymentHistoryUserAgent2,
                    userPaymentHistoryUserAgent3,
                    userPaymentHistoryBrowserUserAgent,
                    userPaymentHistoryBrowserUUID,
                    userPaymentHIstoryUserAppRendersAt,
                    userPaymentHistoryMemo
                )
            SELECT 
                userPaymentHistoryUserId,
                ${now},
                userPaymentHistoryPaymentPointId,
                userPaymentHistoryPaymentPoint,
                null,
                userPaymentHistoryAFCode,
                userPaymentHistoryInvitationCode,
                '2',
                userPaymentHistoryPaymentPattern,
                userPaymentHistoryPayerName,
                userPaymentHistoryPayerTelNo,
                userPaymentHistoryPayerMail,
                userPaymentHistoryCardNo,
                userPaymentHistoryCardExpired,
                userPaymentHistoryCardCVC,
                userPaymentHistoryCardHolderName,
                userPaymentHistoryCardBrand,
                userPaymentHistoryCardCompany,
                userPaymentHistoryCardFingerPrint,
                userPaymentHistoryPayerZipcode,
                userPaymentHistoryPayerAddress,
                userPaymentHistoryIPAddress1,
                userPaymentHistoryIPAddress2,
                userPaymentHistoryIPAddress3,
                userPaymentHistoryIPAddress4,
                userPaymentHistoryIPAddress5,
                userPaymentHistoryIPAddress6,
                userPaymentHistoryIPAddress7,
                userPaymentHistoryIPAddress8,
                userPaymentHistoryPaymentStartedAt,
                userPaymentHistory3DSecureStartedAt,
                null,
                userPaymentHistoryErrorCode,
                userPaymentHistoryTrackingData,
                userPaymentHistoryTrackingData2,
                userPaymentHistoryUserAgent1,
                userPaymentHistoryUserAgent2,
                userPaymentHistoryUserAgent3,
                userPaymentHistoryBrowserUserAgent,
                userPaymentHistoryBrowserUUID,
                userPaymentHIstoryUserAppRendersAt,
                null
            FROM 
                UserPaymentHistory
            WHERE 
                userPaymentHistoryId = ?`;
            console.log("dup_sql",dup_sql);
            await mysql_con.execute(dup_sql, [pointHistoryUserPaymentHistoryId]);
        }
        response = { message: "success" };
        return getResponse(response, 200);

    } catch (error) {
        console.error("error:", error)
        return getResponse(error, 400);
    } finally {
        if (mysql_con) await mysql_con.close();

        try {
            await cluster.disconnect();
        } catch (err) {
            console.log('err', err)
        }
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