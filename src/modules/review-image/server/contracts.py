from pydantic import BaseModel, Field


class CreateImage(BaseModel):
    storeId: str
    productDataUrl: str = Field(min_length=1, max_length=7_100_000)
    prompt: str = Field(min_length=1, max_length=10_000)
    scope: str
    templateName: str | None = None
    excludeTemplate: str | None = None
    conversationSessionId: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


class UploadTemplate(BaseModel):
    storeId: str
    fileName: str = Field(min_length=1, max_length=255)
    imageDataUrl: str = Field(min_length=1, max_length=7_100_000)


class DeleteTemplates(BaseModel):
    storeId: str
    names: list[str] = Field(min_length=1, max_length=500)


class UploadImage(BaseModel):
    storeId: str


class FinishUpload(BaseModel):
    attemptId: str
    result: dict[str, str] | None = None
