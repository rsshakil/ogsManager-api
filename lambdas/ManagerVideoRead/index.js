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

        //get list
        if (pathParameters === null) {
            const { filter, sort } = queryStringParameters || {};

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
            let orderBy = commonFunctions1.convertToMySQLSort(sort, 'videoId DESC');

            // const use_count_subquery = `
            // SELECT 
            //     COUNT(userCouponCouponId) AS totalUseCount
            // FROM UserCoupon
            // WHERE userCouponCouponId = couponId`;


            const sql_data = `
                SELECT 
                    videoId,
                    videoName,
                    videoPath
                FROM Video
                ${where}
                ${having}
                ${orderBy}`;

            console.log('final  sql_data ', sql_data)
            const [query_result_data] = await mysql_con.query(sql_data, parameter);

            response = {
                count: 0,
                records: query_result_data,
            }
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