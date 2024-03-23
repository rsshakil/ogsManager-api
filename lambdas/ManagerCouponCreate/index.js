/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

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
    }

    // Database info
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    let {
        couponName,
        couponCode,
        couponStatus,
        couponStartDate,
        couponEndDate,
        couponLimitCount,
        couponPoint,
        createdBy = null,
        updatedBy = null
    } = JSON.parse(event.body);

    let mysql_con;
    let response = {};
    
    couponStartDate = Math.floor(couponStartDate / 1000);
    couponEndDate = Math.floor(couponEndDate / 1000);
    const createdAt = Math.floor(new Date().getTime() / 1000);

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        await mysql_con.beginTransaction();

        let insert_query = `
            INSERT INTO Coupon (
                couponName,
                couponCode,
                couponStatus,
                couponStartDate,
                couponEndDate,
                couponLimitCount,
                couponPoint,
                couponCreatedAt,
                couponUpdatedAt,
                couponCreatedBy,
                couponUpdatedBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const sql_param = [
            couponName,
            couponCode,
            couponStatus,
            couponStartDate,
            couponEndDate,
            couponLimitCount,
            couponPoint,
            createdAt,
            createdAt,
            createdBy,
            updatedBy
        ];

        const [query_result] = await mysql_con.execute(insert_query, sql_param);

        await mysql_con.commit();

        response = {
            message: "success"
        };

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