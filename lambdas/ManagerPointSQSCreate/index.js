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
 * ManagerPointSQSCreate.
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
        userId,
        point,
        detailStatus,
        paymentPattern,
        executedAt,
    } = JSON.parse(event.body);

    let mysql_con;
    let response = {};

    try {
        // 購入パターン
        if (detailStatus == 1) {
            const sqsParams = {
                MessageBody: JSON.stringify({
                    userId: userId,
                    point: point,
                    paymentValue: point,
                    detailStatus: detailStatus,
                    paymentPattern: paymentPattern,
                    executeAt: executedAt
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
            response = { message: "success" };
        }
        // それ以外
        else {
            const sqsParams = {
                MessageBody: JSON.stringify({
                    userId: userId,
                    point: point,
                    detailStatus: detailStatus,
                    executeAt: executedAt
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
            response = { message: "success" };
        }
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