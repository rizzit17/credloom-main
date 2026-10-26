import joblib
import pandas as pd
import numpy as np
import warnings
warnings.filterwarnings("ignore")

def predict_ai_risk_score(total_transactions, num_previous_loans, total_previous_loans_eth, 
                          holding_days, Tier, model_path='best_gbr_risk_model_2.pkl', feature_path='feature_names_2.pkl'):
    # ... same as before, add Tier to new_data_dict: 'Tier': [Tier]
    model = joblib.load(model_path)
    feature_names = joblib.load(feature_path)
    
    new_data_dict = {
        'total_transactions': [total_transactions],
        'num_previous_loans': [num_previous_loans],
        'total_previous_loans_eth': [total_previous_loans_eth],
        'holding_days': [holding_days],
        'Tier': [Tier]
    }
    new_df = pd.DataFrame(new_data_dict)
    new_df['borrow_per_day'] = new_df['total_previous_loans_eth'] / new_df['holding_days'].replace(0, 1e-6)
    new_df = new_df[feature_names]
    
    risk_raw = model.predict(new_df)[0]
    ai_risk_score = int((1 - risk_raw) * 1000)
    return ai_risk_score, risk_raw


# Input Params
# (Total_transactions, Num_of_previous_Loans, Loan_Amt_eth, Account_holding_days, Tier)
# Same params, vary Tier
print("Tier 1:", predict_ai_risk_score(10, 5, 25, 60, 1)[0])
print("Tier 2:", predict_ai_risk_score(10, 5, 25, 60, 2)[0])   
print("Tier 3:", predict_ai_risk_score(10, 5, 25, 60, 3)[0])  


# !!!! Commands for fetching data

# cURL
"""
curl -X POST http://<IP>:<PORT>/predict \
  -H "Content-Type: application/json" \
  -d '{
    "total_transactions": 100,
    "num_previous_loans": 2,
    "total_previous_loans_eth": 1.5,
    "holding_days": 30,
    "Tier": 1
  }'
"""

# Python
"""
import requests
response = requests.post('http://<IP>:<PORT>/predict', json={
'total_transactions': 100,
'num_previous_loans': 2,
'total_previous_loans_eth': 1.5,
'holding_days': 30,
'Tier': 1
})
print(response.json())
"""

'''
The next logic should be something like this: 
based on the credit score generated, we are generating dynamic interest percentages
while the lender will be agreeing upon the dynamic interest range. 

'''


