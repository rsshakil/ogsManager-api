/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

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
    }

    // Database info
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        //Retrive tag records
        const tag_item_count_subquery = `
            SELECT 
                COUNT(*)
            FROM ItemTag
            WHERE ItemTag.itemTagTagId = Tag.tagId
        `;

        const tag_records_query = `
            SELECT 
                tagId, 
                tagName,
                tagOrder,
                (${tag_item_count_subquery}) AS itemCount 
            FROM Tag
            ORDER BY tagOrder ASC
        `;
        const [tag_records, query_fields] = await mysql_con.query(tag_records_query);

        const systemInfoQuery = `SELECT serviceInfoTagMemo FROM ServiceInfo ORDER BY serviceInfoId ASC LIMIT 1;`;
        const [system_info, query_fields_system_count] = await mysql_con.query(systemInfoQuery);

        response = {
            records: tag_records,
            tagMemo: system_info[0].serviceInfoTagMemo
        }

        console.log('my response', response)

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    } catch (error) {
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