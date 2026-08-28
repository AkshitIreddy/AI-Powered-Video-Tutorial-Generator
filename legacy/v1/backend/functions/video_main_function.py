from datetime import datetime
import os
from functions.create_audio_image_function import create_audio_image
from functions.create_script_function import create_script
from functions.create_video_from_audio_function import create_video_from_audio
from functions.create_image_videos_function import create_image_videos
from functions.combine_videos_function import combine_videos
from functions.get_image_function import get_image


def video_main(topic_name, level_of_explanation, age, creativity_level, humour_level, character_name):
    timestamp = datetime.now().strftime("%Y_%m_%d_%H_%M_%S")
    os.makedirs(timestamp)
    os.makedirs(f'{timestamp}/audio')
    os.makedirs(f'{timestamp}/images')
    os.makedirs(f'{timestamp}/video')
    os.makedirs(f'{timestamp}/video_temp')
    os.makedirs(f'{timestamp}/image_videos')

    script = create_script(topic_name, level_of_explanation,
                           age, creativity_level, humour_level)
    create_audio_image(script, character_name, timestamp)
    create_video_from_audio(timestamp, character_name)
    create_image_videos(timestamp)
    combine_videos(timestamp)

    return f"{timestamp}/final_video.mp4"
