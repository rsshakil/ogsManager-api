/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
const crypto = require("crypto");
const redis = require('ioredis');

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
        process.env.REGISTURL = dbinfo.REGISTURL
        process.env.MAILFROM = dbinfo.MAILFROM
        process.env.DIRECTION = dbinfo.DIRECTION;
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

    const DIRECTION = (process.env.DIRECTION) ? process.env.DIRECTION : 1;

    const data = JSON.parse(event.body) || [];

    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        const { changes = [], type = '', patternType, items = [] } = data;

        if (type === 'pattern') {
            const table = 'IPBlockPattern';

            // Retrieve existing IDs from the database
            const sql = `SELECT ipBlockPatternId FROM ${table} WHERE ipBlockPatternType = ?`;
            const [allResult] = await mysql_con.query(sql, [patternType]);
            const existingIds = allResult.map(row => row.ipBlockPatternId);
            console.log('existingIds', existingIds);

            const requestExistingIds = items.map(item => {
                if (item?.ipBlockPatternId) {
                    return item.ipBlockPatternId;
                }
            });
            console.log('requestExistingIds', requestExistingIds);

            // Find the IDs that do not exist in requestExistingIds but exist in existingIds
            const notExistIds = existingIds.filter(id => !requestExistingIds.includes(id));
            console.log("notExistIds:", notExistIds);

            // If not in the existing IDs, delete it
            if (notExistIds.length > 0) {
                const deleteSql = `DELETE FROM ${table} WHERE ipBlockPatternId IN (?)`;
                await mysql_con.query(deleteSql, [notExistIds]);
                console.log(`Deleted item with id ${notExistIds}`);
            }

            for (const item of items) {
                const singleSql = `SELECT * FROM ${table} WHERE ipBlockPatternId = ?`;
                const [singleResult] = await mysql_con.query(singleSql, [item.ipBlockPatternId]);
                const existingItem = singleResult.length > 0 ? singleResult[0] : null;

                if (existingItem) {
                    // Update existing record
                    const updateSql = `UPDATE ${table} SET ? WHERE ipBlockPatternId = ?`;
                    await mysql_con.query(updateSql, [item, item.ipBlockPatternId]);
                    console.log(`Updated item with id ${existingItem.ipBlockPatternId}`);
                } else {
                    // Insert new record
                    const insertSql = `INSERT INTO ${table} SET ?`;
                    await mysql_con.query(insertSql, [item]);
                    console.log(`Inserted new item`);
                }
            }

            await mysql_con.commit();
        }
        else {
            const removeRecords = changes.filter(x => x.type == 'remove');

            // blocklistのチェック
            const ipBlockKey = `ipblock:${ENVID}:${patternType}:list`;
            const ipBlockConditionKey = `ipblock:${ENVID}:${patternType}:condition`;
            console.log('ipBlockKey', ipBlockKey);
            if (removeRecords.length > 0) {
                for (let i = 0; i < removeRecords.length; i++) {
                    let item = removeRecords[i].key;
                    await cluster.zrem(ipBlockKey, item);
                    await cluster.zrem(ipBlockConditionKey, item);
                }
            }
        }

        if (type === 'pattern' || type === 'patternOrder') {
            // lambdaを起動 ガチャデータのRedisへの出力（順番も生成される）
            let invokeParams = {
                FunctionName: "SystemRedisOtherExport-" + process.env.ENV,
                InvocationType: "RequestResponse",
            };
            // invoke lambda
            let result = await lambda.invoke(invokeParams).promise();
            if (result.$response.error) throw (101, result.$response.error.message);
        }

        response = "Success";

        return getResponse(response, 200);
    } catch (error) {
        console.error("error:", error)
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify({
                errorCode: 501,
                message: "Block list update error"
            }),
        }
    } finally {
        if (mysql_con) await mysql_con.close();
    }

    function getResponse(data, statusCode = 200) {
        return {
            statusCode,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(data),
        };
    }
};
