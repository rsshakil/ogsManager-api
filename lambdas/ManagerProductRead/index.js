/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const redis = require('ioredis');

const commonFunctions = require('./commonFunctions/getWhereFromFilter');
const commonFunctions1 = require('./commonFunctions/convertToMySQLSort');

const PAGES_VISITED = 0;
const ITEMS_PER_PAGE = 500;

const mapperKeys = {
    categoryTranslateName: "gachaCategoryId",
}
const havingKeys = ['gachaStatus', 'roundNumber', 'displayedCondition', 'eventCondition'];

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
    }
    const ENVID = process.env.ENVID;
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

    const redisConfig = [
        { host: process.env.REDISPOINT1, port: 6379 },
        { host: process.env.REDISPOINT2, port: 6379 }
    ];
    // ユーザー情報をRedisに書き出す
    const cluster = new redis.Cluster(
        redisConfig,
        {
            dnsLookup: (address, callback) => callback(null, address),
            redisOptions: { tls: true }
        }
    );

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const { queryStringParameters = null, pathParameters = null } = event || {};

        const now = Math.floor(new Date().getTime() / 1000);

        //get list
        if (pathParameters === null) {
            const { skip: offset = PAGES_VISITED, take: limit = ITEMS_PER_PAGE, filter, sort } = queryStringParameters || {};

            let where = '';
            let having = '';

            if (filter) {
                const { condition = '', conditionParameters = [], havingCondition = '', havingConditionParameters = [] } = commonFunctions.getWhereFromFilter(filter, mapperKeys, havingKeys);

                where = condition;
                parameter = [...parameter, ...conditionParameters];

                if (havingCondition) {
                    having = havingCondition;
                    parameter = [...parameter, ...havingConditionParameters];
                }
            }

            console.log('my where is ', where);
            console.log('my where parameter is ', parameter);
            console.log('my having ', having);

            let orderBy = commonFunctions1.convertToMySQLSort(sort, 'gachaOrder ASC');


            const displayConditionField = `
            CASE WHEN gachaStatus = 1 AND gachaViewFlag > 0 THEN
                CASE WHEN ${now} >= gachaPostStartDate THEN          
                    CASE WHEN ${now} > gachaStartDate THEN         
                        CASE WHEN (gachaRemainingCount = 0 OR ${now} >= gachaEndDate) THEN
                            CASE WHEN gachaSoldOutFlag = 1 THEN 1 
                            ELSE 2 END
                        ELSE 1 END 
                    ELSE 1 END  
                ELSE (
                    CASE WHEN ${now} > gachaStartDate THEN         
                        CASE WHEN (gachaRemainingCount = 0 OR ${now} >= gachaEndDate) THEN
                            CASE WHEN gachaSoldOutFlag = 1 THEN 1 
                            ELSE 2 END
                        ELSE 1 END 
                    ELSE 2 END  
                ) END 
            ELSE (
                CASE WHEN gachaStatus = 1 AND (gachaRemainingCount = 0 OR ${now} >= gachaEndDate) THEN
                    CASE WHEN gachaSoldOutFlag = 1 THEN 1 
                    ELSE 2 END
                ELSE 2 END 
            ) END`;

            const eventConditionField = `
            CASE WHEN gachaStatus = 1 AND gachaViewFlag > 0 THEN
                CASE WHEN ${now} >= gachaPostStartDate THEN          
                    CASE WHEN ${now} > gachaStartDate THEN         
                        CASE WHEN (gachaRemainingCount = 0 OR ${now} >= gachaEndDate) THEN 
                            CASE WHEN gachaSoldOutFlag = 1 THEN 2 
                            ELSE 2 END
                        ELSE 1 END 
                    ELSE 2 END  
                ELSE (
                    CASE WHEN ${now} > gachaStartDate THEN         
                        CASE WHEN (gachaRemainingCount = 0 OR ${now} >= gachaEndDate) THEN
                            CASE WHEN gachaSoldOutFlag = 1 THEN 2 
                            ELSE 2 END
                        ELSE 1 END 
                    ELSE 2 END  
                ) END 
            ELSE (
                CASE WHEN gachaStatus = 1 AND (gachaRemainingCount = 0 OR ${now} >= gachaEndDate) THEN
                    CASE WHEN gachaSoldOutFlag = 1 THEN 2 
                    ELSE 2 END
                ELSE 2 END 
            ) END`;



            const sql_count = `
                SELECT COUNT(*) as total_rows FROM 
                (
                    SELECT
                        CASE WHEN gachaStatus = 3 THEN 3  ELSE gachaViewFlag END AS gachaStatus,
                        (${displayConditionField}) AS displayedCondition,
                        (${eventConditionField}) AS eventCondition,
                        CASE
                            WHEN gachaLuckyNumber1 != '' OR gachaLuckyNumber2 != '' OR gachaLuckyNumber3 != '' OR gachaLuckyNumber4 != '' OR gachaLuckyNumber5 != '' OR gachaLuckyNumber6 != '' OR gachaLuckyNumber7 != '' THEN 1
                            ELSE 0
                        END AS roundNumber
                    FROM Gacha
                    JOIN GachaTranslate ON Gacha.gachaId = GachaTranslate.gachaTranslateGachaId AND gachaTranslateJpFlag = ?
                    JOIN CategoryTranslate ON Gacha.gachaCategoryId = CategoryTranslate.categoryTranslateCategoryId AND categoryTranslateJpFlag = ?
                    ${where} ${having}
                ) AS gachaTable`;

            console.log('count sql ', sql_count)

            const [query_result_count, query_fields_count] = await mysql_con.query(sql_count, [1, 1, ...parameter]);


            const sql_data = `
                SELECT 
                gachaId,
                CASE WHEN gachaStatus = 3 THEN 3 ELSE gachaViewFlag END AS gachaStatus,
                (${displayConditionField}) AS displayedCondition,
                (${eventConditionField}) AS eventCondition,
                gachaRemainingCount,
                gachaDirectionId,
                gachaSoldOutFlag,
                categoryTranslateName, 
                gachaPostStartDate*1000 AS gachaPostStartDate,
                gachaStartDate*1000 AS gachaStartDate,
                gachaEndDate*1000 AS gachaEndDate,
                gachaRemainingDisplayFlag,
                gachaTranslateName, 
                gachaOrder,
                gachaConosecutiveCount,
                gachaConosecutivePoint,
                gachaSinglePoint,
                gachaTotalCount,
                gachaLimitCount,
                gachaLimitOnce,
                gachaLimitOncePerDay,
                gachaLimitEveryonePerDay,
                gachaCreatedAt*1000 AS gachaCreatedAt,
                gachaUpdatedAt*1000 AS gachaUpdatedAt,
                gachaBuiltedAt*1000 AS gachaBuiltedAt,
                CASE
                    WHEN gachaLuckyNumber1 != '' OR gachaLuckyNumber2 != '' OR gachaLuckyNumber3 != '' OR gachaLuckyNumber4 != '' OR gachaLuckyNumber5 != '' OR gachaLuckyNumber6 != '' OR gachaLuckyNumber7 != '' THEN 1
                    ELSE 0
                END AS roundNumber,
                CASE
                    WHEN gachaStatus = 1 AND gachaStartDate >= UNIX_TIMESTAMP() AND gachaEndDate <= UNIX_TIMESTAMP() THEN 1
                    ELSE 2
                END AS gachaViewFlag,
                CASE
                    WHEN gachaStatus = 1 AND gachaStartDate >= UNIX_TIMESTAMP() AND gachaEndDate <= UNIX_TIMESTAMP() THEN 1
                    ELSE 2
                END AS gachaExecuteFlag
                FROM Gacha
                JOIN GachaTranslate ON Gacha.gachaId = GachaTranslate.gachaTranslateGachaId AND gachaTranslateJpFlag = ?
                JOIN CategoryTranslate ON Gacha.gachaCategoryId = CategoryTranslate.categoryTranslateCategoryId AND categoryTranslateJpFlag = ?
                ${where}
                ${having}
                ${orderBy}
                LIMIT ?, ?`;

            parameter.push(Number(offset));
            parameter.push(Number(limit));

            console.log('final  sql_data ', sql_data)

            let [query_result_data] = await mysql_con.query(sql_data, [1, 1, ...parameter]);

            console.log("query_result_data beforeRedisLen", query_result_data);

            response = {
                count: query_result_count[0]?.total_rows,
                records: query_result_data,
            }
        }
        //get detail
        else if (pathParameters !== null) {
            const { gachaId = 0 } = pathParameters || {};

            //For initial data
            if (gachaId == 'init') {
                const category_query = `
                    SELECT 
                        categoryTranslateCategoryId AS categoryId, 
                        categoryTranslateName AS categoryName 
                    FROM CategoryTranslate 
                    JOIN Translate ON categoryTranslateTranslateId = Translate.translateId
                    WHERE categoryTranslateJpFlag = ?
                    ORDER BY categoryId ASC
                `;
                const genre_query = `
                    SELECT 
                        genreTranslateGenreId AS genreId, 
                        genreTranslateName AS genreName 
                    FROM GenreTranslate 
                    JOIN Translate ON genreTranslateTranslateId = Translate.translateId
                    WHERE genreTranslateJpFlag = ?
                    ORDER BY genreId ASC
                `;

                const tags_query = `
                    SELECT  
                        tagId, 
                        tagName
                    FROM Tag 
                    ORDER BY tagId ASC
                `;

                const translate_query = `
                    SELECT 
                        translateId,
                        Language.languageName AS translateName,
                        translateJpFlag
                    FROM Translate
                    INNER JOIN Language ON Translate.translateLanguageId = Language.languageId
                    ORDER BY translateId ASC
                `;


                const [query_result_category, query_fields_category] = await mysql_con.query(category_query, [1]);
                const [query_result_genre, query_fields_genre] = await mysql_con.query(genre_query, [1]);
                const [query_result_tag, query_fields_tag] = await mysql_con.query(tags_query, []);
                const [query_result_translate, query_fields_translate] = await mysql_con.query(translate_query, [1]);

                response = {
                    categories: query_result_category,
                    genres: query_result_genre,
                    tags: query_result_tag,
                    translates: query_result_translate,
                }

            }
            //For item details
            else {
                const gacha_translate_subquery = `
                    SELECT 
                        JSON_ARRAYAGG(
                            JSON_OBJECT(
                                'translateId', Translate.translateId,
                                'translateName', Language.languageName,
                                'gachaTranslateTranslateId', Translate.translateId,
                                'gachaTranslateJpFlag', Translate.translateJpFlag,
                                'gachaTranslateName', GachaTranslate.gachaTranslateName,
                                'gachaTranslateDescription', GachaTranslate.gachaTranslateDescription,
                                'gachaTranslateImageMain', GachaTranslate.gachaTranslateImageMain,
                                'gachaTranslateImageDetail', GachaTranslate.gachaTranslateImageDetail
                            )
                        )
                    FROM Translate 
                    LEFT OUTER JOIN GachaTranslate  ON GachaTranslate.gachaTranslateTranslateId = Translate.translateId AND GachaTranslate.gachaTranslateGachaId = Gacha.gachaId
                    INNER JOIN Language ON Translate.translateLanguageId = Language.languageId
                    WHERE 1
                    ORDER BY translateJpFlag DESC, translateId ASC
                    `;

                const gacha_price_subquery = `
                    SELECT 
                        JSON_ARRAYAGG(
                            JSON_OBJECT(
                                'gachaPrizeType',GachaPrize.gachaPrizeType,
                                'gachaLabel', case when GachaPrize.gachaPrizeType = 0 then GachaPrize.gachaPrizeName else CONCAT('[おまけ]', GachaPrize.gachaPrizeName) END,
                                'newItem', case when GachaPrize.gachaPrizeType=0 then 1 else 0 END,
                                'gachaPrizeId', GachaPrize.gachaPrizeId,
                                'gachaPrizeName', GachaPrize.gachaPrizeName,
                                'gachaPrizeOrder', GachaPrize.gachaPrizeOrder
                            )
                        )
                    FROM GachaPrize 
                    WHERE Gacha.gachaId = GachaPrize.gachaPrizeGachaId
                    AND gachaPrizeStatus = 1
                    ORDER BY gachaPrizeOrder ASC
                    `;

                const sql_data = `
                    SELECT 
                    gachaId,
                    gachaDirectionId,
                    gachaTranslateName, 
                    gachaSoldOutFlag,
                    categoryTranslateName, 
                    gachaPostStartDate*1000 AS gachaPostStartDate,
                    gachaStartDate*1000 AS gachaStartDate,
                    gachaEndDate*1000 AS gachaEndDate,
                    gachaRemainingDisplayFlag,
                    gachaCarouselFlag,
                    gachaViewFlag,
                    gachaStatus,
                    gachaCategoryId,
                    gachaGenreId,
                    gachaMemo,
                    gachaLimitResetPrize,
                    gachaBonusExcludePrize,
                    gachaCreatedAt,
                    gachaUpdatedAt,
                    gachaBuiltedAt,
                    (${gacha_translate_subquery}) AS gachaTranslates,
                    (${gacha_price_subquery}) AS gachaPrizes
                    FROM Gacha
                    JOIN GachaTranslate ON Gacha.gachaId = GachaTranslate.gachaTranslateGachaId AND gachaTranslateJpFlag = 1
                    JOIN CategoryTranslate ON Gacha.gachaCategoryId = CategoryTranslate.categoryTranslateCategoryId AND categoryTranslateJpFlag = 1
                    WHERE gachaId = ?
                    LIMIT 0, 1
                    `;


                parameter.push(Number(gachaId));

                const [query_result_data, query_fields_data] = await mysql_con.query(sql_data, parameter);

                if (query_result_data.length > 0)
                    response = { records: query_result_data[0] }
                else
                    response = { message: 'no data', }

            }
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
        await cluster.disconnect();
        if (mysql_con) await mysql_con.close();
    }
}