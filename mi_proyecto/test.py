from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.webdriver.chrome.options import Options
import time

options = Options()
options.add_argument('--headless')
options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})

driver = webdriver.Chrome(options=options)
driver.get("http://127.0.0.1:8080/")

time.sleep(1)

# Click on Modo Educativo
try:
    tabs = driver.find_elements(By.CLASS_NAME, "nav-item")
    for tab in tabs:
        if "Modo Educativo" in tab.text:
            tab.click()
            break
except Exception as e:
    print("Error clicking Modo Educativo:", e)

time.sleep(1)

# Click on Simulación Sismo
try:
    edu_tabs = driver.find_elements(By.CLASS_NAME, "edu-tab-btn")
    for b in edu_tabs:
        if "Simulación" in b.text:
            b.click()
            break
except Exception as e:
    print("Error clicking Simulación Sismo:", e)

time.sleep(3)

logs = driver.get_log('browser')
for log in logs:
    print(log['source'], log['level'], log['message'])

driver.quit()
