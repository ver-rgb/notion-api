# notion-api
Integrates Google Books API and Goodreads web scraping to input book data into a Notion database.

## How It Works
1. Searches through your Books database to filter for pages with an ISBN but blank Names (aka the book title)
2. Uses the Google API to extract the title, first author (in title case), publication year, and ISBN
3. Scrapes web data from Goodreads to extract the average rating, number of ratings, series name, number in series, image link for cover, and the first four most tagged genres
4. Checks if a page for the book exists in the Series database. If one does, it updates the page. If not, it creates a new page.
5. Creates the Amazon and Goodreads link with the ISBN info
6. Inputs all this info into the Book and Series databases

# Installation
Organized in this order:
1. Create & Retrieve NOTION_KEY
2. Get NOTION_DATABASE_ID & SERIES_DATABASE_ID
3. Clone & Edit GitHub Repo
4. Run Code

Skip to whichever section you need
   
## Create & Retrieve NOTION_KEY
Open this link [Notion API](https://www.notion.so/profile/integrations)

Log into your Notion account and click "New integration"
* Add any integration name
* Select your workspace under "Associated workspace"
* Set Type as **Internal**
* Then, hit **Save**

Now, you should have a new Integration key.

Click it and find **Internal Integration Secret**. That will be your NOTION_KEY

## Get NOTION_DATABASE_ID & SERIES_DATABASE_ID
Duplicate this [template](https://gentle-catmint-460.notion.site/Book-Tracker-Template-223502ca107a80c19eeaffd38cb0c861?pvs=143) for the Books & Series databases 
* It will already have two example ISBNS (9780006498858, 9780063021426), so you can check if it runs properly

**IMPORTANT!!** After duplicating the template:
1. Click the three dots at the top right of the page
2. Hover over **Connections**
3. Select the Notion API connection you just created

Repeat this if you ever copy the database to another page!

The database ID from "Book List" will be NOTION_DATABASE_ID
The database ID from "Series List" will be SERIES_DATABASE_ID

To retrieve the IDs, use this [tutorial from Notion](https://developers.notion.com/reference/retrieve-a-database)

## Clone & Edit GitHub Repo
Clone this GitHub Repo by copying this exact code to your terminal
```
git clone https://github.com/ver-rgb/notion-api.git
cd notion-api
npm install js-yaml
```
Now open the config.yaml file, and replace the placeholder IDs with the ones explained in the above steps.

## Run Code
After the config.yaml file is updated, run this code

```
npm run dev
```

This will run through your Books database once and update your books.

If you need to run it again another time, just run this code in your terminal:
```
cd notion-api
npm run dev
```

Good luck! If there are any issues, leave a comment.

**Note:** This is my first ever full project and first time creating a GitHub repo. So I apologize in advance for any errors, and I will do my best to fix them as they go.














