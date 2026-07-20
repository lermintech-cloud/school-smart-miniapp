const API =
"https://script.google.com/macros/s/AKfycbx8PJDCDw7qSegH9chbQkjZSxVsx1-GtZZvqnqMQcX1aDZx2u13ECFIlL6OVEytqdfdEg/exec?action=dashboard_v2";

fetch(API)
.then(r=>r.json())
.then(data=>{

    document.getElementById("weather").innerHTML=data.weather;

    document.getElementById("pm25").innerHTML=data.pm25;

});
