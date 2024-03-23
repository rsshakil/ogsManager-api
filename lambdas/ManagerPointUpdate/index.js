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

        await mysql_con.beginTransaction();

        const { changes } = data;

        //Identify create/update/remove records
        const createRecords = changes.filter(x => x.type == 'insert' && Object.keys(x.data).length > 0);
        const updateRecords = changes.filter(x => x.type == 'update');
        const removeRecords = changes.filter(x => x.type == 'remove');

        

        //Update
        if (updateRecords.length > 0) {
            for (const tag of updateRecords) {
                const { data, key } = tag || {};
                let update_query = 'UPDATE Point SET';
                const queryParams = [];
        
                if (data.pointName) {
                    update_query += ' pointName = ?,';
                    queryParams.push(data.pointName);
                }
        
                if (data.pointOrder !== undefined && data.pointOrder !== null) {
                    update_query += ' pointOrder = ?,';
                    queryParams.push(data.pointOrder);
                }
        
                if (data.pointValue !== undefined && data.pointValue !== null) {
                    update_query += ' pointValue = ?,';
                    queryParams.push(data.pointValue);
                }
        
                if (data.pointPrice !== undefined && data.pointPrice !== null) {
                    update_query += ' pointPrice = ?,';
                    queryParams.push(data.pointPrice);
                }
        
                if (data.pointStatus !== undefined && data.pointStatus !== null) {
                    update_query += ' pointStatus = ?,';
                    queryParams.push(data.pointStatus);
                }
        
                if (data.pointCreditStripeFlag !== undefined && data.pointCreditStripeFlag !== null) {
                    update_query += ' pointCreditStripeFlag = ?,';
                    queryParams.push(data.pointCreditStripeFlag);
                }
        
                if (data.pointCreditEpsilonFlag !== undefined && data.pointCreditEpsilonFlag !== null) {
                    update_query += ' pointCreditEpsilonFlag = ?,';
                    queryParams.push(data.pointCreditEpsilonFlag);
                }
        
                if (data.pointBankStripeFlag !== undefined && data.pointBankStripeFlag !== null) {
                    update_query += ' pointBankStripeFlag = ?,';
                    queryParams.push(data.pointBankStripeFlag);
                }
        
                if (data.pointBankEpsilonFlag !== undefined && data.pointBankEpsilonFlag !== null) {
                    update_query += ' pointBankEpsilonFlag = ?,';
                    queryParams.push(data.pointBankEpsilonFlag);
                }
        
                if (data.pointBankManualFlag !== undefined && data.pointBankManualFlag !== null) {
                    update_query += ' pointBankManualFlag = ?,';
                    queryParams.push(data.pointBankManualFlag);
                }
        
                if (data.pointPaypayEpsilonFlag !== undefined && data.pointPaypayEpsilonFlag !== null) {
                    update_query += ' pointPaypayEpsilonFlag = ?,';
                    queryParams.push(data.pointPaypayEpsilonFlag);
                }
        
                if (data.pointPaypayFlag !== undefined && data.pointPaypayFlag !== null) {
                    update_query += ' pointPaypayFlag = ?,';
                    queryParams.push(data.pointPaypayFlag);
                }
        
                if (data.pointConvenienceStoreFlag !== undefined && data.pointConvenienceStoreFlag !== null) {
                    update_query += ' pointConvenienceStoreFlag = ?,';
                    queryParams.push(data.pointConvenienceStoreFlag);
                }
        
                // Remove trailing comma if tagName or tagOrder exists in data
                if (queryParams.length > 0) {
                    update_query = update_query.slice(0, -1); // Remove trailing comma
                    update_query += ' WHERE pointId = ?';
                    queryParams.push(key);
        
                    console.log("update data", data);
                    await mysql_con.execute(update_query, queryParams);
                }
            }
        }

        //Delete
        if (removeRecords.length > 0) {
            const remove_query = `DELETE FROM Point WHERE pointId IN (?)`;
            const removeRecordIds = removeRecords.map(x => x.key);
            console.log("removeRecordIds", removeRecordIds);

            await mysql_con.query(remove_query, [removeRecordIds]);
        }

        //Insert
        if (createRecords.length > 0) {
            const read_sql = `select pointOrder,pointId from Point order by pointOrder asc`;
            let [pointResults] = await mysql_con.query(read_sql, []);
            
            if(pointResults && pointResults.length>0){
                let update_order_sql = `UPDATE Point SET pointOrder = ? where pointId = ?`;
                for(let i=0;i<pointResults.length;i++){
                    await mysql_con.query(update_order_sql, [createRecords.length+i+1,pointResults[i].pointId]);
                }
            }

            const insert_query = `INSERT INTO Point (pointName,
                pointValue,
                pointPrice,
                pointStatus,
                pointOrder,
                pointCreditStripeFlag,
                pointCreditEpsilonFlag,
                pointBankStripeFlag,
                pointBankEpsilonFlag,
                pointBankManualFlag,
                pointPaypayEpsilonFlag,
                pointPaypayFlag,
                pointConvenienceStoreFlag) VALUES ?`;
            const parameter = createRecords.map((x,i) => [
                x.data.pointName,
                x.data.pointValue,
                x.data.pointPrice,
                x.data.pointStatus,
                createRecords.length-i,
                x.data?.pointCreditStripeFlag?x.data?.pointCreditStripeFlag:0,
                x.data.pointCreditEpsilonFlag?x.data.pointCreditEpsilonFlag:0,
                x.data.pointBankStripeFlag?x.data.pointBankStripeFlag:0,
                x.data.pointBankEpsilonFlag?x.data.pointBankEpsilonFlag:0,
                x.data.pointBankManualFlag?x.data.pointBankManualFlag:0,
                x.data.pointPaypayEpsilonFlag?x.data.pointPaypayEpsilonFlag:0,
                x.data.pointPaypayFlag?x.data.pointPaypayFlag:0,
                x.data.pointConvenienceStoreFlag?x.data.pointConvenienceStoreFlag:0,
            ]);
            console.log("insert parameter", parameter);

            await mysql_con.query(insert_query, [parameter]);
        }

        await mysql_con.commit();
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
        if (mysql_con) await mysql_con.rollback();
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
