/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

const sqs = new AWS.SQS();
const queueUrl2 = `https://sqs.ap-northeast-1.amazonaws.com/225702177590/InventorySQS-${process.env.ENV}.fifo`;

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
    const cluster = new redis.Cluster(
        redisConfig,
        {
            dnsLookup: (address, callback) => callback(null, address),
            redisOptions: { tls: true }
        }
    );

    let mysql_con;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const { pathParameters: { gachaId = 0 } } = event || {};
        if (!gachaId) return getResponse({ message: 'gachaId is missing in pathParameters' }, 507);

        const gacha_data_query = `SELECT gachaId, gachaStatus, gachaStopStatus FROM Gacha WHERE gachaId = ?`;
        const [query_result_gacha_data] = await mysql_con.query(gacha_data_query, [gachaId]);

        if (query_result_gacha_data.length > 0) {
            const { gachaStatus, gachaStopStatus } = query_result_gacha_data[0] || {};

            if ([1, 2].includes(gachaStatus) && gachaStopStatus == 0) {
                // 在庫変動をSQSに
                const params2 = {
                    MessageBody: JSON.stringify({ gachaId, inventoryId: 8 }),
                    QueueUrl: queueUrl2,
                    MessageGroupId: "INVENTORY_EXECUTE",
                    MessageDeduplicationId: uuidv4(),
                };
                await sqs.sendMessage(params2).promise();
            }
            else if ([3, 4, 5].includes(gachaStatus)) {
                // 在庫変動をSQSに
                const params2 = {
                    MessageBody: JSON.stringify({ gachaId, inventoryId: 9 }),
                    QueueUrl: queueUrl2,
                    MessageGroupId: "INVENTORY_EXECUTE",
                    MessageDeduplicationId: uuidv4(),
                };
                await sqs.sendMessage(params2).promise();
            }
        }

        return getResponse({ message: "Operation success" }, 200);

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