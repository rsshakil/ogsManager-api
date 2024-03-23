/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const redis = require('ioredis');
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
    // ユーザー情報をRedisに書き出す
    const cluster = new redis.Cluster(
        redisConfig,
        {
            dnsLookup: (address, callback) => callback(null, address),
            redisOptions: { tls: true }
        }
    );


    const {
        userStatus,
        userBillingFlag,
        userTestUserFlag,
        userMemo,
        updatedBy = null
    } = JSON.parse(event.body);
console.log("event.body", JSON.parse(event.body));
    let mysql_con;
    let response = {};

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        const { pathParameters: { userId = 0 } } = event || {};

        if (!userId) {
            return getResponse({ message: 'userId is missing in pathParameters.' }, 507);
        }

        const updatedAt = Math.floor(new Date().getTime() / 1000);

        await mysql_con.beginTransaction();

        const update_user_query = `
        UPDATE User SET
        userStatus = ?,
        userBillingFlag = ?,
        userTestUserFlag = ?,
        userMemo = ?,
        userUpdatedAt = ?,
        userUpdatedBy = ?
        WHERE userId = ?`;

        const sql_param = [
            userStatus,
            userBillingFlag,
            userTestUserFlag,
            userMemo,
            updatedAt,
            updatedBy,
            userId,
        ];
        // ユーザーステータスのredisを更新する
        const redisKey = "user:" + ENVID + ":" + userId + ":status";
        const status = JSON.parse(await cluster.get(redisKey));
        if (userStatus == 1) {
console.log("status = 1");
            status.s = 1;
        }
        else if (userStatus == 2) {
console.log("status = 2");
            status.s = 2;
        }
        else if (userStatus == 3) {
console.log("status = 3");
            status.s = 3;
        }
        if (userBillingFlag == 0) {
console.log("userBillingFlag = 0");
            status.bf = 0;
        }
        else if (userBillingFlag == 1) {
console.log("userBillingFlag = 1");
            status.bf = 1;
        }
        await cluster.set(redisKey, JSON.stringify(status));

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