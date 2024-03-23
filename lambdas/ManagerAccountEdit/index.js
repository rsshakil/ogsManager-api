/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

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

        //Insert
        if (createRecords.length > 0) {
            const insert_tag_query = `INSERT INTO Account (accountLoginId, accountPassword, accountName, accountRoleType, accountUpdatedAt) VALUES ?`;
            const parameter = createRecords.map(({ data }) => [data.accountLoginId, data.accountPassword, data.accountName, data.accountRoleType??2, correntUnixTimeStamp]);
            console.log("insert parameter", parameter);
            await mysql_con.query(insert_tag_query, [parameter]);
        }

        //Update
        if (updateRecords.length > 0) {
            for (const record of updateRecords) {
                const { data, key } = record || {};
                const { accountLoginId, accountPassword, accountName, accountRoleType, accountUpdatedAt, accountLastLoginAt } = data || {};

                let modifiedFields = [];
                let parameter = [];

                if (accountLoginId) {
                    modifiedFields.push('accountLoginId = ?');
                    parameter.push(accountLoginId);
                }
                if (accountPassword) {
                    modifiedFields.push('accountPassword = ?');
                    parameter.push(accountPassword);
                }
                if (/^(""|''|)$/.test(accountName) || accountName !== undefined) {
                    modifiedFields.push('accountName = ?');
                    parameter.push(accountName);
                }
                if (accountRoleType) {
                    modifiedFields.push('accountRoleType = ?');
                    parameter.push(accountRoleType);
                }

                modifiedFields.push('accountUpdatedAt = ?');
                parameter.push(correntUnixTimeStamp);

                parameter.push(key);

                let update_record_query = '';
                if (modifiedFields.length > 0) update_record_query = `UPDATE Account SET ` + modifiedFields.join(', ') + ` WHERE accountId = ?`;


                if (update_record_query) {
                    await mysql_con.execute(update_record_query, parameter);
                }
            }
        }

        //Delete
        if (removeRecords.length > 0) {
            const remove_records_query = `DELETE FROM Account WHERE accountId IN (?)`;
            const removeRecordIds = removeRecords.map(x => x.key);

            await mysql_con.query(remove_records_query, [removeRecordIds]);
        }

        await mysql_con.commit();

        response = { message: "success" }

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