from app.database import Base, engine
from app.models import PointExtraction, RasterFile, ZonalStats


def init_database():
    Base.metadata.create_all(bind=engine)
    print("Database tables created successfully!")


if __name__ == "__main__":
    init_database()
