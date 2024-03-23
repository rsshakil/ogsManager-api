/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
const crypto = require("crypto");
const redis = require('ioredis');

const PAGES_VISITED = 0;
const ITEMS_PER_PAGE = 500;
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

	const nowTimestamp = Math.floor(new Date().getTime() / 1000);
    const DIRECTION = (process.env.DIRECTION)?process.env.DIRECTION:1;
    let mysql_con;
    let response;
    let parameter = [];
    try {
        mysql_con = await mysql.createConnection(writeDbConfig);

        const { queryStringParameters = null, pathParameters = null } = event || {};
        const { gachaId = 0 } = pathParameters || {};

            if (gachaId) {
                const sql_data = `
                        SELECT 
                        gachaId, 
                        gachaTotalCount,
                        gachaStartDate,
                        gachaHourTargetValue,
                        gachaDayTargetNumberOfPlayers,
                        gachaSinglePoint
                        FROM Gacha
                        WHERE gachaId  = ?
                        LIMIT 0, 1`;

                    parameter.push(Number(gachaId));

                    const [query_result_data] = await mysql_con.query(sql_data, parameter);

                    if (query_result_data.length > 0) {
                        response = {...query_result_data[0]};
                    }else{
                        throw new Error(101);
                    }
            }else{
                throw new Error(101);
            }
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
                message: "No Gacha found"
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
