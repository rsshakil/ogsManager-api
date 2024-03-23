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

const itemMapperKey = {
    itemName: "itemTranslateName",
    tagCount: "itemTagTagId"
}

const tagMapperKey = {}
const havingKeys = ['itemCount', 'itemStockUnsetCount'];

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
    let response = {};

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const { queryStringParameters = null, pathParameters = null } = event || {};

        if (pathParameters == null) {
            //return all gacha
            const gacha_query = `SELECT 
                gachaId,
                CASE 
                    WHEN gachaStatus = 3 THEN 3
                    ELSE gachaViewFlag
                END AS gachaStatus,
                gachaSoldOutFlag,
                gachaPostStartDate*1000 AS gachaPostStartDate,
                gachaStartDate*1000 AS gachaStartDate,
                gachaEndDate*1000 AS gachaEndDate,
                gachaRemainingDisplayFlag,
                gachaTranslateName, 
                gachaOrder,
                gachaTotalCount
            FROM Gacha join GachaTranslate on gachaTranslateGachaId = gachaId and gachaTranslateJpFlag = ? order by gachaOrder,gachaOrderSub ASC`;
            const [query_result_gacha] = await mysql_con.query(gacha_query, [1]);
            response = { gachas: query_result_gacha };
        }
        else if (pathParameters != null) {
            const { gachaId = 0 } = pathParameters || {};

            if (gachaId) {
                if (gachaId == 'init') {
                    const { skip: offset = PAGES_VISITED, take: limit = ITEMS_PER_PAGE, filter, sort, groupKey } = queryStringParameters || {};

                    let where = '';
                    let having = '';

                    if (groupKey) {
                        if (groupKey == 'item') {
                            if (filter) {
                                const { condition = '', conditionParameters = [] } = commonFunctions.getWhereFromFilter(filter, itemMapperKey);
                                
                                if (condition) {
                                    where = condition;
                                    parameter = [...parameter, ...conditionParameters];
                                }
                            }
                        }
                        else if (groupKey == 'tag') {
                            if (filter) {
                                const { condition = '', conditionParameters = [], havingCondition = '', havingConditionParameters = [] } = commonFunctions.getWhereFromFilter(filter, tagMapperKey, havingKeys);
                                
                                if (condition) {
                                    where = condition;
                                    parameter = [...parameter, ...conditionParameters];
                                }
                                if (havingCondition) {
                                    having = havingCondition;
                                    parameter = [...parameter, ...havingConditionParameters];
                                }
                            }
                        }
                    }

                    let tagOrderBy = commonFunctions1.convertToMySQLSort(sort, 'tagOrder ASC');

                    const tag_item_count_subquery = `SELECT COUNT(itemTagId) FROM ItemTag WHERE itemTagTagId = tagId`;
                    const item_tags_subquery = `SELECT CONCAT('（', GROUP_CONCAT(tagName SEPARATOR ','), '）') FROM ItemTag JOIN Tag ON itemTagTagId = tagId WHERE itemTagItemId = itemId`;

                    //const tag_query_count = `SELECT COUNT(tagId) AS total_rows FROM Tag ${where}`;
                    const tag_query = `SELECT CONCAT('tag-', tagId) AS id, CONCAT(tagName, (${tag_item_count_subquery})) AS caption, tagId, tagName, 'tag' AS type,SUM(itemStockUnsetCount) AS itemStockUnsetCount, (${tag_item_count_subquery}) AS itemCount FROM Tag 
                    INNER JOIN ItemTag ON tagId = itemTagTagId
                    LEFT OUTER JOIN Item ON itemTagItemId = itemId
                    INNER JOIN ItemStock ON itemId = itemStockItemId
                    ${where} GROUP BY tagId ${having} ${tagOrderBy}`;

                    const item_query_count = `
                    SELECT 
                        COUNT(DISTINCT itemId) AS  total_rows 
                    FROM Item  
                    JOIN ItemTranslate ON itemTranslateItemId = itemId AND itemTranslateJpFlag = ? 
                    LEFT OUTER JOIN ItemTag ON itemTagItemId = itemId
                    LEFT OUTER JOIN ItemStock ON itemId = itemStockItemId  
                    ${where} AND itemStatus = ?`;

                    let orderBy = commonFunctions1.convertToMySQLSort(sort, 'itemCreatedAt DESC');
                    
                    const item_query = `
                    SELECT DISTINCT itemId,
                        CONCAT('item-', itemId) AS id, 
                        itemTranslateName AS itemName, 
                        'item' AS type, 
                        itemImagePath1,
                        itemStockUnsetCount,
                        itemAttribute2,
                        itemAttribute3,
                        itemAttribute4,
                        itemAttribute5,
                        itemAttribute6,
                        (${item_tags_subquery}) AS tagCount
                    FROM Item JOIN ItemTranslate ON itemTranslateItemId = itemId AND itemTranslateJpFlag = 1 
                    LEFT OUTER JOIN ItemTag ON itemTagItemId = itemId
                    LEFT OUTER JOIN ItemStock ON itemId = itemStockItemId
                    ${where} AND itemStatus = 1
                    ${orderBy}
                    LIMIT ?, ?`;

                    const video_query = `SELECT CONCAT('video' , '-',videoId) as videoId, videoName, 'video' AS type FROM Video`;//turn on for videoTag version

                    // const video_query = `SELECT videoId, videoName, 'video' AS type FROM Video`;
                    const video_tag_records_query = `SELECT CONCAT('videoTag' , '-',videoTagId) as videoTagId, videoTagName, videoTagOrder, 'videoTag' AS type FROM VideoTag ORDER BY videoTagOrder ASC`;

                    if (groupKey == "item") {
                        const [query_result_item_count] = await mysql_con.query(item_query_count, [1, ...parameter, 1]);

                        parameter.push(Number(offset));
                        parameter.push(Number(limit));

                        console.log('final sql ', item_query)
                        console.log('final parameter ', parameter)

                        const [query_result_item_data] = await mysql_con.query(item_query, [...parameter]);

                        response = { key: 'item', caption: 'アイテム', records: query_result_item_data, count: query_result_item_count[0]?.total_rows };
                    }
                    else if (groupKey == 'tag') {
                        console.log('tag_query', tag_query);
                        const [query_result_tag_data] = await mysql_con.query(tag_query, [...parameter]);
                        response = { key: 'tag', caption: 'タグ', records: query_result_tag_data };
                    }
                    else {
                        const [query_result_video_data] = await mysql_con.query(video_query, []);
                        const [query_result_videoTag_data] = await mysql_con.query(video_tag_records_query, []);
                        const [query_result_tag_data] = await mysql_con.query(tag_query, [...parameter]);
                        response = { videos: query_result_video_data, videoTags:query_result_videoTag_data, tags: query_result_tag_data };
                    }
                }
                else {
                    const gacha_prize_subquery = `
                        SELECT 
                        JSON_ARRAYAGG(
                            JSON_OBJECT(
                                'gachaPrizeId', gachaPrizeId,
                                'gachaPrizeName', gachaPrizeName,
                                'gachaPrizeType', gachaPrizeType,
                                'gachaPrizeOrder', gachaPrizeOrder,
                                'gachaPrizePoint', gachaPrizePoint,
                                'gachaPrizeEmissionsCount', gachaPrizeEmissionsCount,
                                'gachaPrizeSetVideo', gachaPrizeSetVideo,
                                'gachaPrizeSetItem', gachaPrizeSetItem
                            )
                        )
                        FROM GachaPrize
                        WHERE gachaId = gachaPrizeGachaId
                        AND gachaPrizeStatus = 1
                        ORDER BY gachaPrizeOrder ASC`;

                    const sql_data = `
                        SELECT 
                        gachaId , 
                        gachaTotalCount,
                        gachaLoopFlag,
                        gachaBuildStatus,
                        gachaSinglePoint,
                        gachaConosecutiveCount,
                        gachaConosecutivePoint, 
                        gachaLimitOncePerDay, 
                        gachaLimitOnce,
                        gachaLimitEveryonePerDay,
                        gachaAllRestCount,
                        gachaLimitCount,
                        gachaLastOneFlag,
                        gachaLuckyNumber1,
                        gachaLuckyNumber1MatchFlag,
                        gachaLuckyNumber2,
                        gachaLuckyNumber2MatchFlag,
                        gachaLuckyNumber3,
                        gachaLuckyNumber3MatchFlag,
                        gachaLuckyNumber4,
                        gachaLuckyNumber4MatchFlag,
                        gachaLuckyNumber5,
                        gachaLuckyNumber5MatchFlag,
                        gachaLuckyNumber6,
                        gachaLuckyNumber6MatchFlag,
                        gachaLuckyNumber7,
                        gachaLuckyNumber7MatchFlag,
                        gachaMemo,
                        (${gacha_prize_subquery}) AS gachaPrizes
                        FROM Gacha
                        WHERE gachaId  = ?
                        LIMIT 0, 1`;

                    parameter.push(Number(gachaId));

                    const [query_result_data] = await mysql_con.query(sql_data, parameter);

                    if (query_result_data.length > 0) {
                        const [row] = query_result_data;
                        let record = { ...row };

                        if (row.gachaPrizes) {
                            record.gachaPrizes = row.gachaPrizes.sort((a, b) => a.gachaPrizeOrder - b.gachaPrizeOrder);

                            const fetchData = async (key, values = []) => {
                                let queryResults = [];

                                if (key == 'item' & values.length > 0) {
                                    const item_tags_subquery = `SELECT CONCAT('（', GROUP_CONCAT(tagName SEPARATOR ','), '）') FROM ItemTag JOIN Tag ON itemTagTagId = tagId WHERE itemTagItemId = itemTranslateItemId`;

                                    const item_sql = `
                                        SELECT 
                                            CONCAT('item-', itemTranslateItemId) AS id,
                                            itemTranslateName AS itemName,
                                            itemAttribute3,
                                            itemAttribute4,
                                            itemAttribute5,
                                            (${item_tags_subquery}) AS tagCount,
                                            'item' AS type
                                        FROM 
                                            ItemTranslate
                                        JOIN
                                            Item ON itemId = itemTranslateItemId
                                        WHERE 
                                            itemTranslateJpFlag = ? 
                                        AND itemTranslateItemId IN (?)`;
                                    const [item_results] = await mysql_con.query(item_sql, [1, values]);

                                    queryResults = item_results
                                }
                                return queryResults;
                            };

                            const processData = async (array) => {
                                const results = await Promise.all(array.map(async (prize) => {
                                    if (prize?.gachaPrizeSetItem) {
                                        const selectedItems = JSON.parse(prize.gachaPrizeSetItem) || [];

                                        let groups = selectedItems.reduce((acc, item) => {
                                            let arr = item.split("-");

                                            const prefix = arr[0];
                                            const value = arr[1];

                                            acc[prefix] = acc[prefix] ? [...acc[prefix], value] : [value];
                                            return acc;
                                        }, {});

                                        const keys = Object.keys(groups);

                                        let records = [];
                                        for (const key of keys) {
                                            const values = groups[key] || [];

                                            let result = [];
                                            if (key == 'item') result = await fetchData(key, values);

                                            records = [...records, ...result];
                                        }

                                        return { ...prize, gachaPrizeSetItemData: records }
                                    }

                                    return { ...prize, gachaPrizeSetItemData: [] };
                                }));
                                // console.log(results); // Process the results as needed
                                return results;
                            };

                            const modifiedGachaPrizes = await processData(record.gachaPrizes);
                            record.gachaPrizes = modifiedGachaPrizes;
                        }

                        response = { records: record };
                    }
                }
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
        if (mysql_con) await mysql_con.close();
    }
};