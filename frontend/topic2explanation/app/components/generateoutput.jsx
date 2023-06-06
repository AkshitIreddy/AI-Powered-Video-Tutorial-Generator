export const generateOutput = async (
  message,
  level,
  age,
  creative,
  humour,
  characterName,
  setLoading,
  setVideoUrl
) => {
  const headers = new Headers();
  headers.append("Content-Type", "application/json");
  headers.append("Authorization", "Basic " + btoa("myusername:mypassword"));

  const body = JSON.stringify({
    message,
    level,
    age,
    creative,
    humour,
    characterName,
  });

  const response = await fetch("http://127.0.0.1:8000/videoCreate", {
    method: "POST",
    body: body,
    headers: headers,
  });

  if (response.ok) {
    const blob = await response.blob();
    const videoUrl = URL.createObjectURL(blob);
    setVideoUrl(videoUrl);
    console.log("Success");
  } else {
    console.log("Error:", response.statusText);
  }
  setLoading(false);
};
