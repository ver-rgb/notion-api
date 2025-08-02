require('dotenv').config();
const NOTION_KEY = process.env.NOTION_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SERIES_DATABASE_ID = process.env.NOTION_DATABASE_ID;

const axios = require('axios');
const { Client } = require('@notionhq/client');
const cheerio = require('cheerio');
const notion = new Client({auth: NOTION_KEY});
const fs = require("fs");

const bookData = [];
const bookArray = [];

// Pause to give Notion time to process
const sleep = (milliseconds) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
};

// Filters ISBNs with empty titles and puts them into the bookData array
async function getISBN() {
  const databaseId = NOTION_DATABASE_ID;

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

// If a page for the book exists in the Series database, updates the page. If not, creates a new page.
async function getOrCreateSeriesPage(seriesName, coverImage, author) {
  if (!seriesName) return null;

  // Search for a page in the Series database with this name
  const search = await notion.databases.query({
    database_id: SERIES_DATABASE_ID,
    filter: {
      property: 'Name',
      title: {
        contains: seriesName
      }
    }
  });

  if (search.results.length > 0) {
    // If page exists, return its ID
    return search.results[0].id;
  }

  // Doesn't exist — create a new page
  const newPage = await notion.pages.create({
    parent: { database_id: SERIES_DATABASE_ID },
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
  
  return result;
}

async function getBook(bookData) {
  for (const book of bookData) {
  const pageid = book.id;
  const isbn = book.isbn;
  
  const response = await axios.get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`)
    .then((response) => {
      
      // Helper function to convert a string to sentence case
      function toTitleCase(str) {
        if (!str) return '';
        return str.replace(/\w\S*/g, function(txt) {
          return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        });
      }
      
      // Extracts the page id, title, first author (in title case), number of pages, publication year, and ISBN from the volumeInfo
      const bookIndex = {
        "page-id": pageid,
        "title": response.data.items[0].volumeInfo.title ?? "Unknown",
        "author": toTitleCase(response.data.items[0].volumeInfo.authors[0]) ?? "Unknown",
        "publication": response.data.items[0].volumeInfo.publishedDate?.slice(0,4) ?? "Unknown",
        "isbn": isbn
      };
      
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
        .replace(/<br\s*\/?>/gi, '\n')      
        .replace(/<\/?[^>]+(>|$)/g, '')      
        .replace(/&nbsp;/gi, ' ')              
        .replace(/\u00A0/g, ' ')               
        .replace(/^[\s\u00A0]+/, '')           
        .replace(/\n[ \t]+/g, '\n')            
        .trim();                               
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
        genresArray.push(genre);
      });
      
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

      // HOLY SHIT YOU FINALLY FUCKING WORKED
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
        data["description"] = `Unable to retrieve description for ${data["title"]} because at least one paragraph is over 2000 characters in length.`
        console.log(`Unable to retrieve description for ${data["title"]} because at least one paragraph is over 2000 characters in length.`)
      } else {
        data["description"] = splitLength;
      }
      data["page-count"] = Number(pageCount) ?? 0;

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
              "name": "TBR"
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
      
  })();
};
};



getISBN().then(() => 
  getBook(bookData)
);
