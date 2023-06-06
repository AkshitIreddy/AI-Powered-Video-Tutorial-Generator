"use client";
import React from "react";
import { useState, useEffect } from "react";
import Box1 from "./box1";
import Box2 from "./box2";
import { generateOutput } from "./generateoutput";

export default function Main() {
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState("beginner");
  const [age, setAge] = useState(18);
  const [creative, setCreative] = useState(8);
  const [humour, setHumour] = useState(6);
  const [characterName, setCharacterName] = useState("Benjamin");
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");

  useEffect(() => {
    if (loading) {
      generateOutput(
        message,
        level,
        age,
        creative,
        humour,
        characterName,
        setLoading,
        setVideoUrl
      );
    }
  }, [age, characterName, creative, humour, level, loading, message]);

  return (
    <div className="flex-grow grid grid-cols-4 mx-4 my-6 space-x-4">
      <div className="glass col-span-3">
        <Box1
          message={message}
          setMessage={setMessage}
          level={level}
          age={age}
          creative={creative}
          humour={humour}
          characterName={characterName}
          loading={loading}
          setLoading={setLoading}
          videoUrl={videoUrl}
        />
      </div>
      <div className="glass col-span-1">
        <Box2
          level={level}
          setLevel={setLevel}
          age={age}
          setAge={setAge}
          creative={creative}
          setCreative={setCreative}
          humour={humour}
          setHumour={setHumour}
          characterName={characterName}
          setCharacterName={setCharacterName}
        />
      </div>
    </div>
  );
}
