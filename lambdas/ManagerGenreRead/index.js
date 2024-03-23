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

        const { path = '' } = event || {};

        let whereCondition = ''
        if (path.includes('jp')) whereCondition = ` AND genreTranslateJpFlag = 1 `;

        //Retrive genre headers
        const genre_header_query = `
            SELECT 
                Language.languageId, 
                Language.languageName,
                Translate.translateId,
                Translate.translateJpFlag
            FROM Language
            JOIN Translate ON Language.languageId = Translate.translateLanguageId
            ORDER BY Translate.translateId ASC
        `;
        const [genre_header_data, query_fields_count] = await mysql_con.query(genre_header_query, []);


        //Retrive genre records
        const placeholders = genre_header_data.map(() => '?').join(',');
        const parameter = genre_header_data.map(x => x.translateId);

        const genre_names_subquery = `
            SELECT 
                JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'genreTranslateId', GenreTranslate.genreTranslateId,
                        'genreTranslateName', GenreTranslate.genreTranslateName,
                        'genreTranslateTranslateId', GenreTranslate.genreTranslateTranslateId
                    )
                )
            FROM GenreTranslate
            WHERE Genre.genreId = GenreTranslate.genreTranslategenreId 
            ${whereCondition} AND genreTranslateTranslateId IN (${placeholders})
            ORDER BY genreTranslateTranslateId ASC
        `;

        const genre_records_query = `
            SELECT  
            Genre.genreId,
                (${genre_names_subquery}) AS genreTranslateNames
            FROM Genre
        `;
        const [genre_records, query_fields_genre_count] = await mysql_con.query(genre_records_query, parameter);

        const systemInfoQuery = `SELECT serviceInfogenreMemo AS genreMemo FROM ServiceInfo ORDER BY serviceInfoId ASC LIMIT 1;`;
        const [system_info, query_fields_system_count] = await mysql_con.query(systemInfoQuery);

        response = {
            headers: genre_header_data,
            records: genre_records,
            genreMemo: system_info[0].genreMemo
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