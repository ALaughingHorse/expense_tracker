# Context
I would like to develop an expense tracking and budgeting app to montior my own financial health. This becomes important after my recent home purchase. I have created a githug repo - expense_tracker, which is the mother foler of this file. I have another app that records my expesne everyday (let's call this app sharkapp), and the app allows me to export all the recorded expenses as a .csv file. I stored an example ouptut in the local_data folder. 

# App Specs 
This expense app should achieve the following:

## Data management
0. Expense data are extremely small, to make things easy, we can just use local folder and .csv file as the database. In git, please ignore this folder so it doesn't get uploaded to github.

1. Data processing - take in raw .csv files I export from sharkapp, merge to a single .csv file to store an aggregated history of expenses and delete the individual files from the local_data folder.

## UI
0. I should be able to drag the .csv file into the app UI and it takes in the raw file and process it
1. The raw export file has the most granular categories of spends. In the UI, I should be able to create aggregate categories that sum up different granular categories, and set budgets for each aggregated categories - the app should handle the data for category mapping
2. I should be able to set budget each year/month for aggregated or granular categories of expenses, and the UI should show a pacing line - my actual yearly cumulated spend vs linearly paced spend based on budget for that category.
3. The UI should allow me to import my incomes manually as I receive the paychecks - it should allow me to delete and revise if the income is entered incorrectly, and it should handle the data properly. 
4. The Ui should allow a Y/Y income comparison. So in the dashboard, it should have a line chart showing: a. current year cumulative income. b. last year cumulative income. c. current year cumulative spend d. last year cumulative spend. If data past year is empty, just leave empty
