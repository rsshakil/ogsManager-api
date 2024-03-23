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
    let response;

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
            const insert_tag_query = `INSERT INTO Tag (tagName) VALUES ?`;
            const parameter = createRecords.map(x => [x.data.tagName]);
            console.log("insert parameter", parameter);

            await mysql_con.query(insert_tag_query, [parameter]);
        }

        //Update
        if (updateRecords.length > 0) {
            for (const tag of updateRecords) {
                const { data, key } = tag || {};
                let update_tag_query = 'UPDATE Tag SET';
                const queryParams = [];
        
                if (data.tagName) {
                    update_tag_query += ' tagName = ?,';
                    queryParams.push(data.tagName);
                }
        
                if (data.tagOrder !== undefined && data.tagOrder !== null) {
                    update_tag_query += ' tagOrder = ?,';
                    queryParams.push(data.tagOrder);
                }
        
                // Remove trailing comma if tagName or tagOrder exists in data
                if (queryParams.length > 0) {
                    update_tag_query = update_tag_query.slice(0, -1); // Remove trailing comma
                    update_tag_query += ' WHERE tagId = ?';
                    queryParams.push(key);
        
                    console.log("update data", data);
                    await mysql_con.execute(update_tag_query, queryParams);
                }
            }
        }

        //Delete
        if (removeRecords.length > 0) {
            const tag_remove_query = `DELETE FROM Tag WHERE tagId IN (?)`;
            const removeRecordIds = removeRecords.map(x => x.key);
            console.log("removeRecordIds", removeRecordIds);

            await mysql_con.query(tag_remove_query, [removeRecordIds]);
        }

        //Memo
        const systemUpdateQuery = `UPDATE ServiceInfo SET serviceInfotagMemo = ? ORDER BY serviceInfoId ASC LIMIT 1`;
        await mysql_con.execute(systemUpdateQuery, [data.tagMemo]);

        await mysql_con.commit();

        response = {};

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    } catch (error) {
        if (mysql_con) await mysql_con.rollback();
        console.error("error:", error)
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error),
        }
    } finally {
        if (mysql_con) await mysql_con.close();
    }
};