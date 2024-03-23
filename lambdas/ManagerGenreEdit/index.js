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
        const createRecords = data.changes.filter(x => x.type == 'insert' && Object.keys(x.data).length > 1);
        const updateRecords = data.changes.filter(x => x.type == 'update');
        const removeRecords = data.changes.filter(x => x.type == 'remove');

        const insert_genre_translate_query = `INSERT INTO GenreTranslate (genreTranslateGenreId, genreTranslateTranslateId, genreTranslateName, genreTranslateJpFlag) VALUES ?`;

        //Insert
        if (createRecords.length > 0) {
            const insert_genre_query = `INSERT INTO Genre (genreId) VALUES (?)`;
            const genreNullValue = [null];

            for (const genre of createRecords) {
                const insert_genre_sql_param = createRecords.map(x => genreNullValue);
                const [query_result, query_fields_genre] = await mysql_con.query(insert_genre_query, insert_genre_sql_param);

                const { data } = genre || {};
                const translateNames = getTranslateNames(data);

                const insert_genre_translate_sql_params = translateNames.map((name, i) => [query_result.insertId, name.localizeId, name.translateName, name.translateJpFlag]);
                await mysql_con.query(insert_genre_translate_query, [insert_genre_translate_sql_params]);
            }
        }

        //Update
        if (updateRecords.length > 0) {
            const update_genre_translate_query = `
                UPDATE
                GenreTranslate
                SET genreTranslateName = ?, genreTranslateJpFlag = ?
                WHERE genreTranslateId = ?
            `;

            for (const genre of updateRecords) {
                const { data, key } = genre || {};
		        const translateNames = getTranslateNames(data, key);

                for (const name of translateNames) {
                    if (name.genreTranslateId) {
                        const update_genre_translate_sql_params = [name.translateName, name.translateJpFlag, name.genreTranslateId];
                        await mysql_con.query(update_genre_translate_query, update_genre_translate_sql_params);
                    }
                    else {
                        const insert_genre_translate_sql_params = translateNames.map((name, i) => [name.genreId, name.localizeId, name.translateName, name.translateJpFlag]);
                        await mysql_con.query(insert_genre_translate_query, [insert_genre_translate_sql_params]);
                    }
                }
            }
        }

        //Delete
        if (removeRecords.length > 0) {
            const genreIdsToDelete = removeRecords.map(x => x.key.genreId);

            const genre_remove_query = `DELETE FROM Genre WHERE genreId IN (?)`;
            await mysql_con.query(genre_remove_query, [genreIdsToDelete]);

            const genre_translate_remove_query = `DELETE FROM GenreTranslate WHERE genreTranslateGenreId IN (?)`;
            await mysql_con.query(genre_translate_remove_query, [genreIdsToDelete]);
        }

        //Memo
        const systemUpdateQuery = `UPDATE ServiceInfo SET serviceInfoGenreMemo = ? ORDER BY serviceInfoId ASC LIMIT 1`;
        await mysql_con.execute(systemUpdateQuery, [data.genreMemo]);

        await mysql_con.commit();

        response = {
            records: {}
        };

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

    function getTranslateNames(data, key={}) {
        let translateNames = [];

        for (let arrKey in data) {
            if (arrKey !== '__KEY__') {
                const localizeInfo = arrKey.replace("genreTranslateName", "");
                // Here localizeInfoArr[0] --> localizeId & localizeInfoArr[1] --> translateJpFlag
                const localizeInfoArr = localizeInfo.split('_');
                const translateName = data[arrKey];
                // Here getting genreTranslateId from data object
                const genreTranslateId = key[`genreTranslateId_${localizeInfoArr[0]}`] ?? null;
                const genreId = key['genreId'] ?? null;

                translateNames.push({
                    translateName,
                    localizeId: Number(localizeInfoArr[0]),
                    translateJpFlag: Number(localizeInfoArr[1]),
                    genreTranslateId,
                    genreId
                });
            }
        }
        return translateNames;
    }
};