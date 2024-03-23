/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
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
    }

    // Database info
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    const data = JSON.parse(event.body) || [];

    let mysql_con;
    let response = {};

    const correntUnixTimeStamp = Math.floor(new Date().getTime() / 1000);

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        await mysql_con.beginTransaction();

        //Identify create/update/remove records
        const createRecords = data.changes.filter(x => x.type == 'insert' && Object.keys(x.data).length > 0);
        const updateRecords = data.changes.filter(x => x.type == 'update');
        const removeRecords = data.changes.filter(x => x.type == 'remove');

        const redisKeyExists = (redisKey) => {
            return new Promise((resolve) => {
                mysql_con.query(
                'SELECT systemRedisKey FROM SystemData WHERE systemRedisKey = ? LIMIT 1',
                [redisKey],
                (error, result) => {
                if (error) return reject(error);
        
                if (result && result[0]) {
                    console.log('Key exists:', result); // for debug purposes
                    return resolve(true);
                }
                resolve(false);
                });
            });
        };
        //Insert
        if (createRecords.length > 0) {
            const insert_tag_query = `INSERT INTO SystemData (systemKey, systemValue, systemDesc, systemRedisKey) VALUES ?`;
            const select_query = `SELECT systemId,systemRedisKey FROM SystemData WHERE systemRedisKey = ? LIMIT 1`;
            //checkSame key exists or not
            for (const record of createRecords) {
                const { data, key } = record || {};
                console.log("dataOfRecords",data);
                let redisKey = data.systemRedisKey;
                console.log("redisKey",redisKey);
                const [result_exists] = await mysql_con.query(select_query, [redisKey]);
                console.log("result_exists",result_exists);
                if (result_exists && result_exists[0]){
                    //same key exits
                    throw new Error(101);
                }
            }
           
            const parameter = createRecords.map(({ data }) => [data.systemKey, data.systemValue, data.systemDesc, data.systemRedisKey]);
            console.log("insert parameter", parameter);
            await mysql_con.query(insert_tag_query, [parameter]);
        }

        //Update
        if (updateRecords.length > 0) {
            for (const record of updateRecords) {
                const { data, key } = record || {};
                const { systemId, systemKey, systemValue, systemDesc, systemRedisKey } = data || {};
                console.log("key",key);
                let modifiedFields = [];
                let parameter = [];

                if (systemKey) {
                    modifiedFields.push('systemKey = ?');
                    parameter.push(systemKey);
                }
                

                if (systemValue) {
                    modifiedFields.push('systemValue = ?');
                    parameter.push(systemValue);
                }

                if (systemDesc) {
                    modifiedFields.push('systemDesc = ?');
                    parameter.push(systemDesc);
                }
                

                // if (systemRedisKey) {
                //     modifiedFields.push('systemRedisKey = ?');
                //     parameter.push(systemRedisKey);
                // }
                
                parameter.push(key);

                let update_record_query = '';
                if (modifiedFields.length > 0) update_record_query = `UPDATE SystemData SET ` + modifiedFields.join(', ') + ` WHERE systemId = ?`;


                if (update_record_query) {
                    await mysql_con.execute(update_record_query, parameter);
                }

            }
        }

        await mysql_con.commit();

        response = { message: "success" }
        // lambdaを起動 ガチャデータのRedisへの出力（順番も生成される）
		let invokeParams = {
			FunctionName: "SystemRedisOtherExport-" + process.env.ENV,
			InvocationType: "RequestResponse",
		};
		// invoke lambda
		let result = await lambda.invoke(invokeParams).promise();
		if (result.$response.error) throw (101, result.$response.error.message);

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
                errorCode: 101,
                message: "redisキーは重複できません。"
            }),
        };
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