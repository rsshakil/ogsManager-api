/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

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
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
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

    const sqs = new AWS.SQS();
    const queueUrl = `https://sqs.ap-northeast-1.amazonaws.com/225702177590/PointSQS-${process.env.ENV}.fifo`;

    let {
        interventionPoint
    } = JSON.parse(event.body);

    let mysql_con;
    let response = {};

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        const { pathParameters: { userId = 0 } } = event || {};

        if (!userId) {
            return getResponse({ message: 'userId is missing in pathParameters.' }, 507);
        }
        if (!interventionPoint) {
            return getResponse({ message: 'Missing interventionPoint.' }, 200);
        }

        const redisKeyUserPoint = `user:${ENVID}:${userId}:pt`;

        if (interventionPoint > 0) {
            console.log('positive interventionPoint', interventionPoint);
            interventionPoint = Number(interventionPoint);

            //SQS Processing
            const params = {
                MessageBody: JSON.stringify({ userId: userId, point: interventionPoint, detailStatus: 10, executeAt: Math.floor(new Date().getTime() / 1000) }),
                QueueUrl: queueUrl,
                MessageGroupId: "POINTSQS_EXECUTE",
                MessageDeduplicationId: uuidv4()
            };
            await sqs.sendMessage(params).promise();
            console.log("Message published successfully");

            //update user redis data 
            await cluster.incrby(redisKeyUserPoint, interventionPoint);
        }
        else {
            interventionPoint = Math.abs(interventionPoint);
            console.log('negative interventionPoint', interventionPoint);
            
            let currentPoint = await cluster.get(redisKeyUserPoint);
            console.log("currentPoint", currentPoint);

            if (interventionPoint > currentPoint) {
                interventionPoint = currentPoint;
            }

            //SQS Processing
            const params = {
                MessageBody: JSON.stringify({ userId: userId, point: interventionPoint, detailStatus: 11, executeAt: Math.floor(new Date().getTime() / 1000) }),
                QueueUrl: queueUrl,
                MessageGroupId: "POINTSQS_EXECUTE",
                MessageDeduplicationId: uuidv4()
            };
            await sqs.sendMessage(params).promise();
            console.log("Message published successfully");

            //update user redis data
            await cluster.decrby(redisKeyUserPoint, interventionPoint);
        }


        const updatedAt = Math.floor(new Date().getTime() / 1000);

        await mysql_con.beginTransaction();

        const update_user_query = `UPDATE User SET userUpdatedAt = ? WHERE userId = ?`;

        const sql_param = [
            updatedAt,
            userId,
        ];

        await mysql_con.execute(update_user_query, sql_param);

        await mysql_con.commit();
        
        return getResponse(response, 200);

    } catch (error) {
        if (mysql_con) await mysql_con.rollback();
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