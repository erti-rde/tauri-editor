from typing import Annotated
import os
from fastapi import FastAPI, Request, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from PyPDF2 import PdfReader
from transformers import AutoTokenizer, AutoModel
import torch
import torch.nn.functional as F
# look into https://pypi.org/project/semantic-text-splitter/ instead of spacy
import spacy
import multiprocessing
import uvicorn
import pickle

# spacy.prefer_gpu()
nlp = spacy.load("en_core_web_sm")
# Load model from HuggingFace Hub
tokenizer = AutoTokenizer.from_pretrained(
    'sentence-transformers/all-MiniLM-L6-v2')
model = AutoModel.from_pretrained('sentence-transformers/all-MiniLM-L6-v2')

metadata_map = {
    "/Author": "author",
    "/Title": "title",
}

# Mean Pooling - Take attention mask into account for correct averaging


def mean_pooling(model_output, attention_mask):
    # First element of model_output contains all token embeddings
    token_embeddings = model_output[0]
    input_mask_expanded = attention_mask.unsqueeze(
        -1).expand(token_embeddings.size()).float()
    return torch.sum(token_embeddings * input_mask_expanded, 1) / torch.clamp(input_mask_expanded.sum(1), min=1e-9)


def encoder(sentences):
    encoded_input = tokenizer(
        sentences, padding=True, truncation=True, return_tensors='pt')
    # Compute token embeddings
    with torch.no_grad():
        model_output = model(**encoded_input)

    # Perform pooling
    sentence_embeddings = mean_pooling(
        model_output, encoded_input['attention_mask'])

    # Normalize embeddings
    sentence_embeddings = F.normalize(sentence_embeddings, p=2, dim=1)

    return sentence_embeddings


app = FastAPI()

origins = [
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/tokenise-sentence")
def tokeniseSentence(q: str):
    sentence_embeddings = encoder([q])
    return {"result": sentence_embeddings.tolist()}


@app.get("/tokenise-pdf")
async def tokenise_pdf(pdf_path: str, name: str):
    reader = PdfReader(pdf_path)
    details = []

    for i, page in enumerate(reader.pages):
        page_content = page.extract_text()
        last_line = page_content.splitlines()[-1]
        page_number = -1
        # if last new line is a number then remove it and use it as page number
        if last_line.isdigit():
            page_number = int(last_line)
        doc = nlp(page_content)
        sentences = list(doc.sents)
        sentence_array = [str(sentence) for sentence in sentences]

        sentence_vectors = encoder(sentence_array)
        details.append({"page": page_number, "sentences": sentence_array,
                        "vectors": sentence_vectors})

    pickle_files_path = os.path.join(app.tauri_app_dir, "pickle_files")
    if not os.path.exists(pickle_files_path):
        os.makedirs(pickle_files_path)
    pickle_file_name = f"{name}.pickle"
    path_to_save = os.path.join(pickle_files_path, pickle_file_name)
    with open(path_to_save, 'wb') as f:
        pickle.dump(details, f)

    return {"status": "completed"}

def findMetaDataForPickleFile(file):
    metadata_file = file.replace(".pickle", ".metadata.pickle")
    metadata_file_path = os.path.join(app.tauri_app_dir, "pickle_files", metadata_file)
    if os.path.exists(metadata_file_path):
        with open(metadata_file_path, 'rb') as f:
            metadata = pickle.load(f)
            return metadata
    return None
    

@app.get("/find-similar-sentences")
def findSimilarSentences(q: str):
    pickle_files_dir = os.path.join(app.tauri_app_dir, "pickle_files")
    # select file only files that end with .pickle and don't include metadata
    pickle_files = os.listdir(pickle_files_dir)
    pickle_files = [file for file in pickle_files if file.endswith(
        ".pickle") and not file.endswith(".metadata.pickle")]
    similar_sentences = []
    encoded_query = encoder([q])
    for file in pickle_files:
        pickle_file_path = os.path.join(pickle_files_dir, file)
        with open(pickle_file_path, 'rb') as f:
            data = pickle.load(f)
            for page in data:
                for i, vector in enumerate(page['vectors']):
                    similarity = F.cosine_similarity(
                        encoded_query, torch.tensor(vector).unsqueeze(0)).item()
                    similar_sentences.append({
                        "page": page['page'],
                        "sentence": page['sentences'][i],
                        "similarity": round(similarity, 2),
                        "metadata": findMetaDataForPickleFile(file)
                    })
    return {
        "similar_sentences": sorted(similar_sentences,
                                    key=lambda x: x['similarity'], reverse=True)[:5]}


@app.get("/get-metadata")
async def readMetadata(file_name: str):
    pickle_files_path = os.path.join(app.tauri_app_dir, "pickle_files")
    if not os.path.exists(pickle_files_path):
        return HTTPException(status_code=404, detail=f"file {file_name} does not exists")
    pickle_file_name = f"{file_name}.metadata.pickle"
    # read from the pickle file
    path_to_read = os.path.join(pickle_files_path, pickle_file_name)
    with open(path_to_read, 'rb') as f:
        metadata = pickle.load(f)
    return {"metadata": metadata}


@app.post("/create-metadata")
async def createMetadata(pdf_path: str, file_name: str):
    reader = PdfReader(pdf_path)
    mapped_metadata = {}
    for key in reader.metadata.keys():
        # check if author key is present and that it has value
        if key == "/Author" and reader.metadata[key] != "":
            # split the author name into first and last name considering that the first name is the first word and return the rest as last name
            author_array = reader.metadata[key].split(" ", 1)
            mapped_metadata["author"] = {
                "first_name": author_array[0],
                "last_name": author_array[1]
            }
        elif key == "/Title":
            mapped_metadata["title"] = reader.metadata[key]
    # create a pickle file with the metadata and file name
    pickle_files_path = os.path.join(app.tauri_app_dir, "pickle_files")
    if not os.path.exists(pickle_files_path):
        os.makedirs(pickle_files_path)

    pickle_file_name = f"{file_name}.metadata.pickle"
    path_to_save = os.path.join(pickle_files_path, pickle_file_name)
    with open(path_to_save, 'wb') as f:
        pickle.dump(mapped_metadata, f)
    return {"metadata": mapped_metadata}


@app.put("/update-metadata")
async def updateMetadata(data: Annotated[dict, Body()]):
    file_name = data["file_name"]
    metadata = data["metadata"]

    # update the metadata in the pickle file
    pickle_files_path = os.path.join(app.tauri_app_dir, "pickle_files")
    if not os.path.exists(pickle_files_path):
        return HTTPException(status_code=404, detail=f"file {file_name} does not exists")
    pickle_file_name = f"{file_name}.metadata.pickle"
    path_to_save = os.path.join(pickle_files_path, pickle_file_name)
    with open(path_to_save, 'wb') as f:
        pickle.dump(metadata, f)
    return {"metadata": metadata}


@app.delete("/delete-source")
async def deleteMetadata(file_name: str):
    pickle_files_path = os.path.join(app.tauri_app_dir, "pickle_files")
    if not os.path.exists(pickle_files_path):
        return HTTPException(status_code=404, detail=f"file {file_name} does not exists")
    
    pickle_file_name = f"{file_name}.pickle"
    pickle_metadata_file_name = f"{file_name}.metadata.pickle"
    path_to_delete = os.path.join(pickle_files_path, pickle_file_name)
    path_to_delete_metadata = os.path.join(pickle_files_path, pickle_metadata_file_name)
    os.remove(path_to_delete)
    os.remove(path_to_delete_metadata)
    return {"status": "completed"}


@app.get("/ping")
def splitSentences(data_dir: str):
    app.tauri_app_dir = data_dir
    return {"result": "pong"}


if __name__ == '__main__':
    multiprocessing.freeze_support()  # For Windows support
    uvicorn.run(app, host="0.0.0.0", port=8135, reload=False, workers=1)
