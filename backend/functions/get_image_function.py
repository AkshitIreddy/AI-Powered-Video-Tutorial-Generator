from pygoogle_image import image as pi
import shutil
import os


def get_image(query, value, timestamp, count):
    pi.download(keywords=query, limit=value+2)

    # Create the path for the query folder
    query_path = "images"
    folder_name = os.listdir(query_path)[0]
    query_path = os.path.join(query_path, folder_name)

    # Create the path for the timestamp folder
    timestamp_path = f"{timestamp}/images"

    # Get the list of image files in the query folder
    images = [f for f in os.listdir(query_path)]

    # Remove images that are 1 KB
    images = [f for f in images if os.path.getsize(
        os.path.join(query_path, f)) > 2000]

    if len(images) == 0 or images == None:
        images = ["src/backup.jpg"] * value
        # Rename and move the remaining images to the timestamp/images folder
        for image in images:
            extension = os.path.splitext(image)[1]
            new_name = f"{count}{extension}"
            new_path = os.path.join(timestamp_path, new_name)
            shutil.copy(image, new_path)
            count += 1

        # Delete the query folder
        shutil.rmtree(query_path)
        return ""

    # Rename and move the remaining images to the timestamp/images folder
    for image in images:
        extension = os.path.splitext(image)[1]
        new_name = f"{count}{extension}"
        old_path = os.path.join(query_path, image)
        new_path = os.path.join(timestamp_path, new_name)
        shutil.move(old_path, new_path)
        count += 1

    # Delete the query folder
    shutil.rmtree(query_path)
