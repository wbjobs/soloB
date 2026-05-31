#include "PhysicsEngine.h"
#include <cmath>
#include <random>

namespace Physics {

Cloth::Cloth()
    : numCols(0)
    , numRows(0)
    , spacing(20.0f)
    , color({100, 180, 255, 255})
{
}

Cloth::~Cloth() = default;

void Cloth::Initialize(
    float startX, float startY,
    int cols, int rows,
    float spacingBetween,
    float pointMass,
    float stiffness,
    bool pinTopRow
) {
    points.clear();
    springs.clear();

    numCols = cols;
    numRows = rows;
    spacing = spacingBetween;

    points.reserve(static_cast<size_t>(cols * rows));
    for (int row = 0; row < rows; ++row) {
        for (int col = 0; col < cols; ++col) {
            float x = startX + static_cast<float>(col) * spacing;
            float y = startY + static_cast<float>(row) * spacing;

            bool pinned = pinTopRow && (row == 0) && (col % 2 == 0);
            if (pinTopRow && (row == 0) && (col == 0 || col == cols - 1)) {
                pinned = true;
            }

            auto point = std::make_unique<PointMass>(
                Vector2(x, y),
                pointMass,
                pinned
            );
            points.push_back(std::move(point));
        }
    }

    float structuralStiffness = stiffness;
    float shearStiffness = stiffness * 0.7f;
    float bendStiffness = stiffness * 0.1f;

    auto GetPoint = [this](int col, int row) -> PointMass* {
        if (col < 0 || col >= numCols || row < 0 || row >= numRows) return nullptr;
        return points[static_cast<size_t>(row * numCols + col)].get();
    };

    auto AddSpring = [this](PointMass* a, PointMass* b, float restLen, float stiff, float damp) {
        if (!a || !b) return;
        if (restLen <= 0.0f) {
            Vector2 delta = b->position - a->position;
            restLen = delta.Length();
        }
        springs.push_back(std::make_unique<Spring>(a, b, restLen, stiff, damp));
    };

    for (int row = 0; row < rows; ++row) {
        for (int col = 0; col < cols; ++col) {
            PointMass* current = GetPoint(col, row);

            if (col < cols - 1) {
                AddSpring(current, GetPoint(col + 1, row), spacing, structuralStiffness, 0.5f);
            }

            if (row < rows - 1) {
                AddSpring(current, GetPoint(col, row + 1), spacing, structuralStiffness, 0.5f);
            }

            if (col < cols - 1 && row < rows - 1) {
                float diagLen = spacing * std::sqrt(2.0f);
                AddSpring(current, GetPoint(col + 1, row + 1), diagLen, shearStiffness, 0.3f);
                AddSpring(GetPoint(col + 1, row), GetPoint(col, row + 1), diagLen, shearStiffness, 0.3f);
            }

            if (col < cols - 2) {
                AddSpring(current, GetPoint(col + 2, row), spacing * 2.0f, bendStiffness, 0.2f);
            }

            if (row < rows - 2) {
                AddSpring(current, GetPoint(col, row + 2), spacing * 2.0f, bendStiffness, 0.2f);
            }
        }
    }
}

void Cloth::Update(float dt, const Vector2& gravity) {
    const int iterations = 4;
    float subDt = dt / static_cast<float>(iterations);

    for (int iter = 0; iter < iterations; ++iter) {
        for (auto& spring : springs) {
            spring->ApplyForce();
        }

        for (auto& point : points) {
            point->Update(subDt, gravity, 0.99f);
        }

        for (auto& spring : springs) {
            if (!spring->massA || !spring->massB) continue;

            Vector2 delta = spring->massB->position - spring->massA->position;
            float currentLength = delta.Length();

            if (currentLength < 0.0001f) continue;

            float diff = currentLength - spring->restLength;
            if (std::abs(diff) > 0.001f) {
                Vector2 dir = delta / currentLength;
                float correction = diff * 0.5f;

                if (!spring->massA->pinned && !spring->massB->pinned) {
                    spring->massA->position += dir * correction * 0.5f;
                    spring->massB->position -= dir * correction * 0.5f;
                } else if (!spring->massA->pinned) {
                    spring->massA->position += dir * correction;
                } else if (!spring->massB->pinned) {
                    spring->massB->position -= dir * correction;
                }
            }
        }
    }
}

void Cloth::Draw(SDL_Renderer* renderer) const {
    if (points.empty()) return;

    auto GetPoint = [this](int col, int row) -> const PointMass* {
        if (col < 0 || col >= numCols || row < 0 || row >= numRows) return nullptr;
        return points[static_cast<size_t>(row * numCols + col)].get();
    };

    SDL_SetRenderDrawColor(renderer, color.r, color.g, color.b, color.a);

    for (int row = 0; row < numRows; ++row) {
        for (int col = 0; col < numCols; ++col) {
            const PointMass* current = GetPoint(col, row);
            if (!current) continue;

            if (col < numCols - 1) {
                const PointMass* right = GetPoint(col + 1, row);
                if (right) {
                    SDL_RenderDrawLine(
                        renderer,
                        static_cast<int>(current->position.x),
                        static_cast<int>(current->position.y),
                        static_cast<int>(right->position.x),
                        static_cast<int>(right->position.y)
                    );
                }
            }

            if (row < numRows - 1) {
                const PointMass* down = GetPoint(col, row + 1);
                if (down) {
                    SDL_RenderDrawLine(
                        renderer,
                        static_cast<int>(current->position.x),
                        static_cast<int>(current->position.y),
                        static_cast<int>(down->position.x),
                        static_cast<int>(down->position.y)
                    );
                }
            }
        }
    }

    SDL_SetRenderDrawColor(renderer, 255, 255, 255, 255);
    for (const auto& point : points) {
        if (point->pinned) {
            SDL_Rect rect = {
                static_cast<int>(point->position.x - 4),
                static_cast<int>(point->position.y - 4),
                8,
                8
            };
            SDL_RenderFillRect(renderer, &rect);
        } else {
            SDL_Rect rect = {
                static_cast<int>(point->position.x - 2),
                static_cast<int>(point->position.y - 2),
                4,
                4
            };
            SDL_RenderDrawRect(renderer, &rect);
        }
    }
}

PointMass* Cloth::GetPointAt(const Vector2& pos, float radius) {
    float radiusSq = radius * radius;

    for (auto it = points.rbegin(); it != points.rend(); ++it) {
        Vector2 delta = pos - (*it)->position;
        if (delta.LengthSquared() <= radiusSq) {
            return it->get();
        }
    }

    return nullptr;
}

bool Cloth::TryStartDrag(const Vector2& mousePos) {
    PointMass* point = GetPointAt(mousePos, 20.0f);
    if (point && !point->pinned) {
        dragInfo.mass = point;
        dragInfo.isDragging = true;
        dragInfo.dragOffset = point->position - mousePos;
        return true;
    }
    return false;
}

void Cloth::UpdateDrag(const Vector2& mousePos) {
    if (dragInfo.isDragging && dragInfo.mass) {
        Vector2 targetPos = mousePos + dragInfo.dragOffset;
        Vector2 currentPos = dragInfo.mass->position;

        Vector2 delta = targetPos - currentPos;
        dragInfo.mass->velocity = delta * 5.0f;
        dragInfo.mass->position = targetPos;
    }
}

void Cloth::EndDrag() {
    dragInfo.isDragging = false;
    dragInfo.mass = nullptr;
    dragInfo.dragOffset = Vector2(0, 0);
}

}
