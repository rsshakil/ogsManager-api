/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const commonFunctions = require('./commonFunctions/getWhereFromFilter');
const commonFunctions1 = require('./commonFunctions/convertToMySQLSort');
const ssm = new AWS.SSM();

const PAGES_VISITED = 0;
const ITEMS_PER_PAGE = 500;

const mapperKey = {}
const havingKeys = ['totalUseCount'];

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

    let parameter = [];
    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const { queryStringParameters = null, pathParameters = null } = event || {};

        const use_count_subquery = `
            SELECT 
                COUNT(userCouponCouponId) AS totalUseCount
            FROM UserCoupon
            WHERE userCouponCouponId = couponId`;

        //get list
        if (pathParameters === null) {
            const { skip: offset = PAGES_VISITED, take: limit = ITEMS_PER_PAGE, filter, sort } = queryStringParameters || {};

            let where = '';
            let having = '';

            if (filter) {
                const { condition = '', conditionParameters = [], havingCondition = '', havingConditionParameters = [] } = commonFunctions.getWhereFromFilter(filter, mapperKey, havingKeys);

                if (condition) {
                    where = condition;
                    parameter = [...parameter, ...conditionParameters];
                }

                if (havingCondition) {
                    having = havingCondition;
                    parameter = [...parameter, ...havingConditionParameters];
                }
            }

            console.log('my where is ', where);
            console.log('my where parameter is ', parameter);
            let orderBy = commonFunctions1.convertToMySQLSort(sort, 'couponCreatedAt DESC');

            const sql_count = `
            SELECT COUNT(*) AS total_rows FROM (
                SELECT 
                    couponId,
                    (${use_count_subquery}) AS totalUseCount
                FROM Coupon
                ${where}
                ${having}
            ) AS c1`;

            console.log('count sql ', sql_count)
            const [query_result_count] = await mysql_con.query(sql_count, parameter);

            const sql_data = `
                SELECT 
                    couponId,
                    couponStatus,
                    couponName,
                    couponCode,
                    couponStartDate*1000 AS couponStartDate,
                    couponEndDate*1000 AS couponEndDate,
                    couponLimitCount,
                    couponPoint,
                    couponCreatedAt*1000 AS couponCreatedAt,
                    couponUpdatedAt*1000 AS couponUpdatedAt,
                    (${use_count_subquery}) AS totalUseCount
                FROM Coupon
                ${where}
                ${having}
                ${orderBy}
                LIMIT ?, ?`;

            parameter.push(Number(offset));
            parameter.push(Number(limit));

            console.log('final  sql_data ', sql_data)
            const [query_result_data] = await mysql_con.query(sql_data, parameter);

            response = {
                count: query_result_count[0]?.total_rows,
                records: query_result_data,
            }
        }
        //get detail
        else if (pathParameters !== null) {
            const { couponId = 0 } = pathParameters || {};

            const sql_data = `
            SELECT 
                couponId,
                couponName,
                couponCode,
                couponStatus,
                couponStartDate*1000 AS couponStartDate,
                couponEndDate*1000 AS couponEndDate,
                couponLimitCount,
                couponPoint,
                couponCreatedAt,
                couponUpdatedAt,
                (${use_count_subquery}) AS totalUseCount
            FROM Coupon
            WHERE couponId = ?
            LIMIT 0, 1`;

            parameter.push(Number(couponId));

            const [query_result_data] = await mysql_con.query(sql_data, parameter);

            if (query_result_data.length > 0) response = { records: query_result_data[0] }
            else response = { message: 'no data', }
        }
        console.log('my response', response)
        return getResponse(response, 200);

    } catch (error) {
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