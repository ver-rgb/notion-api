require('dotenv').config();
const axios = require('axios');
const { Client } = require('@notionhq/client');
const cheerio = require('cheerio');
const notion = new Client({auth: process.env.NOTION_KEY});
const fs = require("fs");

const bookData = [];
const bookArray = [];

// Pause to give Notion time to process (Hopefully bypasses Error 409)
const sleep = (milliseconds) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
};

// Filters ISBNs with empty titles and puts them into bookData array
async function getISBN() {
  const databaseId = process.env.NOTION_DATABASE_ID;

  // Searches through Notion database filtering for ISBNs with empty titles
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      and: [
        {
          property: 'Name',
          title: {
            is_empty: true,
          },
        },
        {
          property: 'ISBN',
          rich_text: {
            is_not_empty: true,
          },
        },
      ]
    },
  });

  // Collects all ISBNs from filtered results
  response.results.forEach((result) => {
    bookData.push({
      id : result.id,
      isbn : result.properties.ISBN.rich_text[0]?.plain_text
    });   
  });

  console.log(bookData);

};

// Scrapes data from Goodreads
async function scrapeSite(keyword) {
  const url = `https://www.goodreads.com/search?q=${keyword}`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  return $
}

// Doesn't matter because Goodreads blocks you reading the shelf names
/*async function getshelfURL(res){
  //WOAHHHH IT WORKS, I DONT ENTIRELY KNOW HWY BUT AT LERAST I GOT THE SHELF URL (last time I will use chatgpt... prolly) -> Get this to check, then fix my arrays to put it all under one array to save space lol
  const jsonText = res('#__NEXT_DATA__').html(); // or use .text()
  const datatwo = JSON.parse(jsonText);
  const apolloState = datatwo.props.pageProps.apolloState;

  // You can either loop or directly reference if you know the work ID key
  const shelveURL = Object.values(apolloState)
    .find(obj => obj?.__typename === 'Work' && obj?.details?.shelvesUrl)?.details?.shelvesUrl;
  console.log('Shelve URL:', shelveURL);

  return shelveURL
}*/

// Guys... I'm sorry I couldn't be bother for a personal project, I created this section of code for the series database (I can figure out the rest myself!!!!!)
async function getOrCreateSeriesPage(seriesName, coverImage, author) {
  if (!seriesName) return null;

  // 1. Search for a page in the Series database with this name
  const search = await notion.databases.query({
    database_id: `22b502ca107a818383aac81795ec1d41`,
    filter: {
      property: 'Name',
      title: {
        contains: seriesName
      }
    }
  });

  if (search.results.length > 0) {
    // Page exists, return its ID
    return search.results[0].id;
  }

  // 2. Doesn't exist — create a new page
  const newPage = await notion.pages.create({
    parent: { database_id: '22b502ca107a818383aac81795ec1d41' },
    "icon": {
        "type": "emoji",
        "emoji": "📚"
      },
    properties: {
      'Name': {
        title: [
          {
            text: {
              content: seriesName
            }
          }
        ]
      },
      "Cover": {
        "files": [
          {
            "type": "external",
            "name": "Book Cover",
            "external": {
              "url": coverImage
            }
          }
        ]
      },
      "Author": {
        "rich_text": [
          {
            "type": "text",
            "text": {
              "content": author
            }
          }
        ]
      },
    }
  });
  
  await sleep(200);
  return newPage.id;
}

// Splits text at every paragraph break since Notion has a character limit of 2000
function splitBlock(str){
  const paraBreak = "\n"
  const result = str.split(paraBreak);
  /*let space = ' ';
  let pos = 0;
  let change = 0;

  while (pos < str.length) {
    change = pos + 1750;
    while (str[change] !== space) {
      change --;
    }
    console.log(str.substring(pos, (pos+change)))
    result.push(str.substring(pos, (pos+change)));
    pos += change;
    change = 0;
  }*/

  //console.log(result)
  return result;
}

async function getBook(bookData) {
  for (const book of bookData) {
  const pageid = book.id;
  const isbn = book.isbn;
  
  const response = await axios.get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`)
    .then((response) => {
      // Helper function to convert a string to sentence case (Help from Overflow and Copilot, no idea how this is working but we leave it)
      function toTitleCase(str) {
        if (!str) return '';
        return str.replace(/\w\S*/g, function(txt) {
          return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        });
      }
      
      // Extracts the page id, title, first author (in title case), number of pages, publication year, and isbn from the volumeInfo
      const bookIndex = {
        "page-id": pageid,
        "title": response.data.items[0].volumeInfo.title ?? "Unknown",
        "author": toTitleCase(response.data.items[0].volumeInfo.authors[0]) ?? "Unknown",
        //"page-count": response.data.items[0].volumeInfo.pageCount,
        "publication": response.data.items[0].volumeInfo.publishedDate?.slice(0,4) ?? "Unknown",
        "isbn": isbn
      };
      
      //console.log(`Fetched ${bookIndex.title}.`);      
      bookArray.push(bookIndex);

    })
    .catch((error) => {
      console.log(`Error retrieving data for ISBN ${isbn}:`, error);
    })

  const webae = await scrapeSite(isbn)
    .then((result) => {
      // Parsing through HTML to get necessary info
      const bookAvgRating = result('.RatingStatistics__rating') || null;
      const bookNumRating = result('.RatingStatistics__meta');
      const Description = result('.BookPageMetadataSection__description');
      const refinedDes = Description.find('span[class="Formatted"]').html()
        .replace(/<br\s*\/?>/gi, '\n')         // HTML <br> to line break || Following replace lines created via ChatGPT
        .replace(/<\/?[^>]+(>|$)/g, '')        // remove all other tags
        .replace(/&nbsp;/gi, ' ')              // encoded &nbsp;
        .replace(/\u00A0/g, ' ')               // decoded non-breaking spaces
        .replace(/^[\s\u00A0]+/, '')           // leading whitespace of all types
        .replace(/\n[ \t]+/g, '\n')            // strip space after line breaks
        .trim();                               // final cleanup
      const imageLink = result('.BookCover__image img.ResponsiveImage');
      const amzLink = `https://www.amazon.com/s?k=${isbn}`;
      const goodLink = `https://www.goodreads.com/search?q=${isbn}`;
      const pageCount = result('.FeaturedDetails').find('p[data-testid="pagesFormat"]').text().replace(',', '').split(' ')[0];
      
      const splitError = false;
      const splitLength = splitBlock(refinedDes);

      splitLength.forEach((obj) => 
        {
          if (obj.length >= 2000) {
            splitError = true;
          }
        }
      );

      // Push first four genre tags into genresArray array 
      const genresArray = []; 
      result('.BookPageMetadataSection__genreButton').each((i,el) => {
        if (i > 3) return false;
        const genre = result(el)
          .find('.Button__labelItem')
          .text();
        //console.log(genre);
        genresArray.push(genre);
      });
      
      // Last ChatGPT (hopefully), everything else should just be refining and adding to page (80% done!!!!)
      // Match: everything before the #, and the number after it
      const output = result('.BookPageTitleSection__title a')?.text().trim();
      const match = output.match(/^(.*)\s+#?(\d+)$/);
      
      let seriesName, seriesNumber;
      if (match) {
        seriesName = match[1].trim();     // "The Stormlight Archive"
        seriesNumber = match[2];          // "1" (without the #)
      } else {
        seriesName = output;
        seriesNumber = null;
      }


      // Updates the array (bookArray) so each object also have the average rating, number of ratings,
      // series name, number in series, image link (.jpg format), genres, amazon link,
      // and description (temp disabled to save space in testing)
      /*bookArray.forEach((obj) => {
        obj;
        obj["avg-Rating"] = parseFloat(bookAvgRating.html());
        obj["numRating"] = bookNumRating.find('span[data-testid="ratingsCount"]').contents().first().text().trim();
        obj["series-name"] = seriesName;
        obj["series-number"] = parseFloat(seriesNumber); 
        obj["imageLink"] = imageLink.attr('src');
        obj["genres"] = genresArray;
        obj["amazon-link"] = amzLink;
        obj["goodreads-link"] = goodLink;
        
        
        
        // Separating so doesn't take up space when console.table
        // obj["description"] = refinedDes;
        
        title = obj["title"];
        indexBook = obj;
        
        
      });*/

      // HOLY SHIT YOU FINALLY FUCKING WORKED THANKS TO FUCKING CHATGPT
      const data = bookArray.find(obj => obj.isbn === isbn);

      data["avg-Rating"] = parseFloat(bookAvgRating.html());
      data["numRating"] = bookNumRating.find('span[data-testid="ratingsCount"]').contents().first().text().trim();
      data["series-name"] = seriesName;
      data["series-number"] = parseFloat(seriesNumber); 
      data["imageLink"] = imageLink.attr('src');
      data["genres"] = genresArray;
      data["amazon-link"] = amzLink;
      data["goodreads-link"] = goodLink;
      if (splitError){
        data["description"] = `Unable to retrieve descrption for ${data["title"]} because at least one paragraph is over 2000 characters in length.`
        console.log(`Unable to retrieve descrption for ${data["title"]} because at least one paragraph is over 2000 characters in length.`)
      } else {
        data["description"] = splitLength;
      }
      data["page-count"] = Number(pageCount) ?? 0;
      //console.log(`Page Count: ${data["page-count"]}`);

      console.log(`Fetched ${data["title"]}. ISBN: ${data["isbn"]}`);

    })
    .catch((error) => {
      console.log(`Error retrieving HTML for ISBN ${isbn}:`, error);
    })

  }

  // Get final array that will be used for Notion page update
  console.log(bookArray);


  for (const val of bookArray){
    console.log(`Page ID: ${val["page-id"]} ISBN: ${val["isbn"]}`);
    
    await sleep(200);

    await (async () => {
      const seriesPageId = await getOrCreateSeriesPage(val["series-name"], val["imageLink"], val["author"]);

      const paragraphBlocks = Array.isArray(val["description"])
      ? val["description"].map(description => ({
          "paragraph": {
          "rich_text": [
            {
              "text": {
                "content": description,
              }
            }
          ]
          }
        }))
      : [];

      const pageId = val["page-id"];
      await sleep(500);

      const res = await notion.pages.update({
        page_id: pageId,
        "icon": {
            "type": "emoji",
            "emoji":"📕"
          },
        properties: {
          "Name": {
            "id": "title",
            "type": "title",
            "title": [
              {
                "type": "text",
                "text": {
                  "content": val["title"],
                  "link": null
                },
                "annotations": {
                  "bold": false,
                  "italic": false,
                  "strikethrough": false,
                  "underline": false,
                  "code": false,
                  "color": "default"
                },
              }
            ]
          },
          "Author":{
            "rich_text": [
              {
                "type": "text",
                "text":{
                "content": val["author"],
                "link": null
                },
                "annotations": {
                  "bold": false,
                  "italic": false,
                  "strikethrough": false,
                  "underline": false,
                  "code": false,
                  "color": "default"
                }
              }
            ]
          },
          "Pages": {
            "number": val["page-count"]
          },
          "Publication Date":{
            "rich_text": [
              {
                "type": "text",
                "text":{
                "content": val["publication"] || "Unknown"
                },
                "annotations": {
                  "bold": false,
                  "italic": false,
                  "strikethrough": false,
                  "underline": false,
                  "code": false,
                  "color": "default"
                }
              }
            ]
          },         
          "Cover": {
            "files": [
              {
                "name": "Cover",
                "external": {
                  "url": val["imageLink"]
                }
              }
            ]
          },
          // I don't really understand how this works but yayyy
          "Genres": {
            "multi_select": Array.isArray(val["genres"])
            ? val["genres"].map(genre => ({ name: genre }))
            : []
          },
          "Average Rating": {
            "number": val["avg-Rating"]
          },
          "Number of Ratings":{
            "rich_text": [
              {
                "type": "text",
                "text":{
                "content": val["numRating"],
                },
                "annotations": {
                  "bold": false,
                  "italic": false,
                  "strikethrough": false,
                  "underline": false,
                  "code": false,
                  "color": "default"
                }
              }
            ]
          },
          "Series Number": {
            "number": val["series-number"]
          },
          "Links": {
            "files": [
              {
                "name": "Amazon",
                "external": {
                  "url": val["amazon-link"]
                }
              },
              {
                "name": "Goodreads",
                "external": {
                  "url": val["goodreads-link"]
                }
              }
            ]
          },
          'Series': {
            relation: seriesPageId
              ? [{ id: seriesPageId }]
              : []  // leave empty if series name is null
          },
          "Status": {
            "status": {
              "name": "Finished"
            }
          },
          
        },
      });

      const response = await notion.blocks.children.append({
        block_id: pageId,
        "children": [
          {
            "heading_2": {
              "rich_text": [
                {
                  "text": {
                    "content": "Book Summary"
                  }
                }
              ]
            }
          },
          ...paragraphBlocks
        ]
      });

      await sleep(400);
      //console.log(res);
  })();
};
};



getISBN().then(() => 
  getBook(bookData)
);

/*for (const isbn of bookData) {
    try {
      const bookResponse = await axios.get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${process.env.GOOGLE_BOOKS_API_KEY}`);
      const bookInfo = bookResponse.data.items[0].volumeInfo;
      const title = bookInfo.title;
      const authors = bookInfo.authors ? bookInfo.authors.join(', ') : 'Unknown';
      console.log(`Title: ${title}, Authors: ${authors}`);
      
      // Update the Notion database with the book title
      await notion.pages.update({
        page_id: result.id,
        properties: {
          Name: {
            title: [
              {
                text: {
                  content: title,
                },
              },
            ],
          },
        },
      });
    } catch (error) {
      console.error(`Error fetching data for ISBN ${isbn}:`, error);
    }
  }
  console.log('All books processed.');
  process.exit(0);*/
