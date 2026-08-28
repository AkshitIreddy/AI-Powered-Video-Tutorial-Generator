import os
import shutil
import subprocess


def create_video_from_audio(timestamp, character_name):
    audio_folder = f"{timestamp}/audio"
    audio_files = os.listdir(audio_folder)

    img_path = f"characters/{character_name}.png"
    output_path = f"{timestamp}/video_temp"

    activate_env_cmd = "SadTalker\\venv\\Scripts\\activate"
    command_template = "python SadTalker/inference.py --driven_audio {audio_path} --source_image {img_path} --result_dir {output_path} --still --preprocess full --enhancer gfpgan"

    for audio_file in audio_files:
        audio_path = f"{audio_folder}/{audio_file}"

        # Run the commands within the same subprocess
        command = f"{activate_env_cmd} && {command_template.format(audio_path=audio_path, img_path=img_path, output_path=output_path)}"
        subprocess.run(command, shell=True)

        # Find the generated video
        video_folder = os.listdir(output_path)[0]
        video_path = f"{output_path}/{video_folder}/{character_name}##{audio_file.split('.')[0]}_enhanced.mp4"

        # Move the generated video to the new folder
        video_output_path = f"{timestamp}/video/{audio_file.split('.')[0]}.mp4"
        shutil.move(video_path, video_output_path)

        # Delete the original subfolder in 'video_temp'
        subfolder_path = f"{output_path}/{video_folder}"
        shutil.rmtree(subfolder_path)
