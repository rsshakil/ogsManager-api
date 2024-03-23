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

    const nowTimestamp = Math.floor(new Date().getTime() / 1000);
    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        const { changes } = data;

        //Identify create/update/remove records
        const createRecords = changes.filter(x => x.type == 'insert' && Object.keys(x.data).length > 0);
        const updateRecords = changes.filter(x => x.type == 'update');
        const removeRecords = changes.filter(x => x.type == 'remove');

        //Insert
        if (createRecords.length > 0) {
            let insert_query = `
                INSERT INTO DomainBlockPattern (
                    domainBlockPatternName,
                    domainBlockPatternCreatedAt
                ) VALUES ?`;

            const parameter = createRecords.map((x, i) => {
                const { data } = x;
                return [
                    data.domainBlockPatternName,
                    nowTimestamp
                ]
            })

            console.log("insert parameter", parameter);

            await mysql_con.query(insert_query, [parameter]);
        }

        //Update
        if (updateRecords.length > 0) {
            for (const record of updateRecords) {
                const { data, key } = record || {};
                let update_query = 'UPDATE DomainBlockPattern SET';
                const queryParams = [];

                if (data.domainBlockPatternName) {
                    update_query += ' domainBlockPatternName = ?,';
                    queryParams.push(data.domainBlockPatternName);
                }
                if (queryParams.length > 0) {
                    update_query = update_query.slice(0, -1); // Remove trailing comma
                    update_query += ' WHERE DomainBlockPatternId = ?';
                    queryParams.push(key);

                    console.log("update data", data);
                    await mysql_con.execute(update_query, queryParams);
                }
            }
        }

        //Delete
        if (removeRecords.length > 0) {
            const delete_query = `DELETE FROM DomainBlockPattern WHERE DomainBlockPatternId IN (?)`;
            const removeRecordIds = removeRecords.map(x => x.key);
            console.log("removeRecordIds", removeRecordIds);

            await mysql_con.query(delete_query, [removeRecordIds]);
        }

        // lambdaを起動 ガチャデータのRedisへの出力（順番も生成される）
        let invokeParams = {
            FunctionName: "SystemRedisOtherExport-" + process.env.ENV,
            InvocationType: "RequestResponse",
        };
        // invoke lambda
        let result = await lambda.invoke(invokeParams).promise();
        if (result.$response.error) throw (101, result.$response.error.message);

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
                message: "Domain block list update error"
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
